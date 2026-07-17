using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Exceptions;
using TodoApi.Models;

namespace TodoApi.Operations;

/// <summary>
/// Plain static operations over <see cref="AppDbContext"/> for the TaskItem resource. Mirrors
/// <see cref="ProjectOperations"/>'s shape: no repository/unit-of-work abstraction, each method
/// takes the DbContext explicitly and is called directly by the thin endpoint handlers in
/// <see cref="TodoApi.Endpoints.TaskEndpoints"/>.
/// </summary>
public static class TaskOperations
{

    public static async Task<List<TaskResponse>> ListByProjectAsync(AppDbContext db, int projectId)
    {
        await EnsureProjectExistsAsync(db, projectId);

        var tasks = await db.Tasks
            .Where(t => t.ProjectId == projectId)
            .OrderBy(t => t.Order)
            .ThenBy(t => t.Id)
            .ToListAsync();

        return tasks.Select(ToResponse).ToList();
    }

    public static async Task<TaskResponse> CreateAsync(AppDbContext db, CreateTaskRequest request)
    {
        var projectId = request.ProjectId!.Value;
        await EnsureProjectExistsAsync(db, projectId);

        var nextOrder = await NextOrderForProjectAsync(db, projectId);

        var task = new TaskItem
        {
            Title = request.Title!,
            Description = request.Description,
            ProjectId = projectId,
            Order = nextOrder,
            IsComplete = false,
            CompletedAt = null,
            CreatedAt = DateTime.UtcNow,
        };

        db.Tasks.Add(task);
        await db.SaveChangesAsync();

        return ToResponse(task);
    }

    public static async Task DeleteAsync(AppDbContext db, int id)
    {
        var task = await FindTaskOrThrowAsync(db, id);

        db.Tasks.Remove(task);
        await db.SaveChangesAsync();
    }

    public static async Task<TaskResponse> PatchAsync(AppDbContext db, int id, PatchTaskRequest request)
    {
        var task = await FindTaskOrThrowAsync(db, id);

        if (request.ProjectId is int targetProjectId)
        {
            await EnsureProjectExistsAsync(db, targetProjectId);

            var nextOrder = await NextOrderForProjectAsync(db, targetProjectId);

            task.ProjectId = targetProjectId;
            task.Order = nextOrder;
        }

        // This must happen before the title/description update because if you are updating the
        // task's isComplete status and title/description in the same request, the task must be
        // updated. In practice, the frontend does not do this right now since it updates
        // the complete and the title/description separately.
        // Could potentially change the API to have separate endpoints for completion vs title/description updates,
        // but a single PATCH felt more understandable as an API.
        if (request.IsComplete is bool isComplete && task.IsComplete != isComplete)
        {
            // Idempotent: a repeat of the same state is a no-op (guarded by the `!=` above), so
            // re-completing an already-complete task keeps its original CompletedAt rather than
            // resetting the timestamp.
            task.IsComplete = isComplete;
            task.CompletedAt = isComplete ? DateTime.UtcNow : null;
        }

        if (request.Title is not null || request.Description is not null)
        {
            // A completed task is locked for field edits; the client must reopen it (uncomplete)
            // first -- unless this same request is the one doing the reopening (handled by the
            // ordering above). The complete/uncomplete toggle, move, and delete all stay allowed
            // even while complete -- only Title/Description are blocked here.
            if (task.IsComplete)
            {
                throw new ForbiddenOperationException(
                    "A completed task cannot be edited. Mark it incomplete first.");
            }

            if (request.Title is not null)
            {
                task.Title = request.Title;
            }

            if (request.Description is not null)
            {
                task.Description = request.Description;
            }
        }

        // If the target project (on a move) is deleted concurrently between the check above and
        // this save, SQLite's FK enforcement rejects the UPDATE and EF Core throws
        // DbUpdateException, which ExceptionHandlingMiddleware maps to a clean 409 Conflict.
        // This rolls back the whole transaction of changes above.
        await db.SaveChangesAsync();

        return ToResponse(task);
    }

    // Every reorder rewrites the whole project's Order sequence to a dense 0..N-1 run, rather than
    // computing a position for just the moved task which would be frought with bugs. Alternatives are to use
    // fractional keys to avoid rewriting the whole list, but you eventually need to renormalize.
    // This sidesteps that complexity, at the cost of an O(N) write per reorder which is okay up until large scale.
    // Other alternative is to use lexicographical ranks. Also additional complexity for now.
    public static async Task<List<TaskResponse>> ReorderAsync(AppDbContext db, ReorderTasksRequest request)
    {
        var projectId = request.ProjectId;
        await EnsureProjectExistsAsync(db, projectId);

        var orderedIds = request.OrderedTaskIds ?? new List<int>();

        if (orderedIds.Count != orderedIds.Distinct().Count())
        {
            throw new ValidationException(
                "OrderedTaskIds",
                "The submitted task list contains duplicate IDs.");
        }

        var currentTasks = await db.Tasks
            .Where(t => t.ProjectId == projectId)
            .ToListAsync();

        var currentIds = currentTasks.Select(t => t.Id).ToHashSet();
        var submittedIds = orderedIds.ToHashSet();

        if (!submittedIds.SetEquals(currentIds))
        {
            throw new ValidationException(
                "OrderedTaskIds",
                "The submitted task list must contain exactly the set of tasks currently in this project.");
        }

        var tasksById = currentTasks.ToDictionary(t => t.Id);

        for (var i = 0; i < orderedIds.Count; i++)
        {
            tasksById[orderedIds[i]].Order = i;
        }

        await db.SaveChangesAsync();

        var reordered = orderedIds.Select(taskId => tasksById[taskId]).ToList();
        return reordered.Select(ToResponse).ToList();
    }

    private static async Task EnsureProjectExistsAsync(AppDbContext db, int projectId)
    {
        var exists = await db.Projects.AnyAsync(p => p.Id == projectId);
        if (!exists)
        {
            throw new NotFoundException($"Project with id {projectId} was not found.");
        }
    }

    private static async Task<TaskItem> FindTaskOrThrowAsync(AppDbContext db, int id)
    {
        return await db.Tasks.FindAsync(id)
            ?? throw new NotFoundException($"Task with id {id} was not found.");
    }

    private static async Task<int> NextOrderForProjectAsync(AppDbContext db, int projectId)
    {
        var hasTasks = await db.Tasks.AnyAsync(t => t.ProjectId == projectId);
        if (!hasTasks)
        {
            return 0;
        }

        var maxOrder = await db.Tasks
            .Where(t => t.ProjectId == projectId)
            .MaxAsync(t => t.Order);

        return maxOrder + 1;
    }

    private static TaskResponse ToResponse(TaskItem task)
    {
        return new TaskResponse
        {
            Id = task.Id,
            Title = task.Title,
            Description = task.Description,
            ProjectId = task.ProjectId,
            Order = task.Order,
            IsComplete = task.IsComplete,
            CompletedAt = task.CompletedAt,
            CreatedAt = task.CreatedAt,
        };
    }
}
