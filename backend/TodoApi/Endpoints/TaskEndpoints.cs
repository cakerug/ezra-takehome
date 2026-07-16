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
        var tasks = app.MapGroup("/api/tasks");

        tasks.MapGet("", async (AppDbContext db, int projectId) =>
        {
            var list = await TaskOperations.ListByProjectAsync(db, projectId);
            return Results.Ok(list);
        }).Produces<List<TaskResponse>>();

        tasks.MapPost("", async (AppDbContext db, CreateTaskRequest request) =>
        {
            var created = await TaskOperations.CreateAsync(db, request);
            return Results.Created($"/api/tasks/{created.Id}", created);
        }).Produces<TaskResponse>(StatusCodes.Status201Created);

        tasks.MapPatch("/{id:int}", async (AppDbContext db, int id, PatchTaskRequest request) =>
        {
            var updated = await TaskOperations.PatchAsync(db, id, request);
            return Results.Ok(updated);
        }).Produces<TaskResponse>();

        tasks.MapDelete("/{id:int}", async (AppDbContext db, int id) =>
        {
            await TaskOperations.DeleteAsync(db, id);
            return Results.NoContent();
        }).Produces(StatusCodes.Status204NoContent);

        tasks.MapPut("/order", async (AppDbContext db, ReorderTasksRequest request) =>
        {
            var reordered = await TaskOperations.ReorderAsync(db, request);
            return Results.Ok(reordered);
        }).Produces<List<TaskResponse>>();

        return app;
    }
}
