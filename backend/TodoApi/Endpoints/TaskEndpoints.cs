using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Operations;

namespace TodoApi.Endpoints;

/// <summary>
/// Registers the Minimal API routes for the TaskItem resource. Handlers are thin: parse the
/// request, delegate to <see cref="TaskOperations"/>, shape the response. No business logic
/// lives here. Mirrors <see cref="ProjectEndpoints"/>'s pattern.
/// </summary>
public static class TaskEndpoints
{
    public static IEndpointRouteBuilder MapTaskEndpoints(this IEndpointRouteBuilder app)
    {
        var projectTasks = app.MapGroup("/api/projects/{projectId:int}/tasks");

        projectTasks.MapGet("", async (AppDbContext db, int projectId) =>
        {
            var tasks = await TaskOperations.ListByProjectAsync(db, projectId);
            return Results.Ok(tasks);
        });

        projectTasks.MapPost("", async (AppDbContext db, int projectId, CreateTaskRequest request) =>
        {
            var created = await TaskOperations.CreateAsync(db, projectId, request);
            return Results.Created($"/api/tasks/{created.Id}", created);
        });

        projectTasks.MapPut("/reorder", async (AppDbContext db, int projectId, ReorderTasksRequest request) =>
        {
            var reordered = await TaskOperations.ReorderAsync(db, projectId, request);
            return Results.Ok(reordered);
        });

        var tasks = app.MapGroup("/api/tasks");

        tasks.MapPut("/{id:int}", async (AppDbContext db, int id, UpdateTaskRequest request) =>
        {
            var updated = await TaskOperations.UpdateAsync(db, id, request);
            return Results.Ok(updated);
        });

        tasks.MapDelete("/{id:int}", async (AppDbContext db, int id) =>
        {
            await TaskOperations.DeleteAsync(db, id);
            return Results.NoContent();
        });

        tasks.MapPut("/{id:int}/complete", async (AppDbContext db, int id) =>
        {
            var updated = await TaskOperations.SetCompleteAsync(db, id, isComplete: true);
            return Results.Ok(updated);
        });

        tasks.MapPut("/{id:int}/uncomplete", async (AppDbContext db, int id) =>
        {
            var updated = await TaskOperations.SetCompleteAsync(db, id, isComplete: false);
            return Results.Ok(updated);
        });

        tasks.MapPut("/{id:int}/move", async (AppDbContext db, int id, MoveTaskRequest request) =>
        {
            var moved = await TaskOperations.MoveAsync(db, id, request);
            return Results.Ok(moved);
        });

        return app;
    }
}
