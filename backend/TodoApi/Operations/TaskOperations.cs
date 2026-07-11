using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Exceptions;
using TodoApi.Models;
using TodoApi.Validation;

namespace TodoApi.Operations;

/// <summary>
/// Plain static operations over <see cref="AppDbContext"/> for the TaskItem resource. Mirrors
/// <see cref="ProjectOperations"/>'s shape: no repository/unit-of-work abstraction, each method
/// takes the DbContext explicitly and is called directly by the thin endpoint handlers in
/// <see cref="TodoApi.Endpoints.TaskEndpoints"/>.
/// </summary>
public static class TaskOperations
{
    private const int TitleMaxLength = 200;
    private const int DescriptionMaxLength = 2000;

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

    public static async Task<TaskResponse> CreateAsync(AppDbContext db, int projectId, CreateTaskRequest request)
    {
        FieldValidation.EnsureRequiredWithMaxLength(request.Title, TitleMaxLength, "Title");
        FieldValidation.EnsureMaxLength(request.Description, DescriptionMaxLength, "Description");

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

    public static async Task<TaskResponse> UpdateAsync(AppDbContext db, int id, UpdateTaskRequest request)
    {
        FieldValidation.EnsureRequiredWithMaxLength(request.Title, TitleMaxLength, "Title");
        FieldValidation.EnsureMaxLength(request.Description, DescriptionMaxLength, "Description");

        var task = await FindTaskOrThrowAsync(db, id);

        // A completed task is locked for editing; the client must reopen it (uncomplete) first.
        // The complete/uncomplete toggle, move, and delete all stay allowed -- only field edits
        // are blocked here.
        if (task.IsComplete)
        {
            throw new ForbiddenOperationException(
                "A completed task cannot be edited. Mark it incomplete first.");
        }

        task.Title = request.Title!;
        task.Description = request.Description;

        await db.SaveChangesAsync();

        return ToResponse(task);
    }

    public static async Task DeleteAsync(AppDbContext db, int id)
    {
        var task = await FindTaskOrThrowAsync(db, id);

        db.Tasks.Remove(task);
        await db.SaveChangesAsync();
    }

    public static async Task<TaskResponse> SetCompleteAsync(AppDbContext db, int id, bool isComplete)
    {
        var task = await FindTaskOrThrowAsync(db, id);

        // Idempotent: a repeat of the same state is a no-op, so re-completing an already-complete
        // task keeps its original CompletedAt rather than resetting the timestamp.
        if (task.IsComplete == isComplete)
        {
            return ToResponse(task);
        }

        task.IsComplete = isComplete;
        task.CompletedAt = isComplete ? DateTime.UtcNow : null;

        await db.SaveChangesAsync();

        return ToResponse(task);
    }

    public static async Task<TaskResponse> MoveAsync(AppDbContext db, int id, MoveTaskRequest request)
    {
        var task = await FindTaskOrThrowAsync(db, id);

        await EnsureProjectExistsAsync(db, request.TargetProjectId);

        var nextOrder = await NextOrderForProjectAsync(db, request.TargetProjectId);

        task.ProjectId = request.TargetProjectId;
        task.Order = nextOrder;

        // If the target project is deleted concurrently between the check above and this save,
        // SQLite's FK enforcement rejects the UPDATE and EF Core throws DbUpdateException, which
        // ExceptionHandlingMiddleware maps to a clean 409 Conflict. No re-check needed here — a
        // re-check can't close the window anyway (the delete can still land after it).
        await db.SaveChangesAsync();

        return ToResponse(task);
    }

    public static async Task<List<TaskResponse>> ReorderAsync(AppDbContext db, int projectId, ReorderTasksRequest request)
    {
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
