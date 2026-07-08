using Microsoft.AspNetCore.Mvc;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Operations;

namespace TodoApi.Endpoints;

/// <summary>
/// Registers the Minimal API routes for the Project resource. Handlers are thin: parse the
/// request, delegate to <see cref="ProjectOperations"/>, shape the response. No business logic
/// lives here.
/// </summary>
public static class ProjectEndpoints
{
    public static IEndpointRouteBuilder MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects");

        group.MapGet("", async (AppDbContext db) =>
        {
            var projects = await ProjectOperations.ListAsync(db);
            return Results.Ok(projects);
        }).Produces<List<ProjectResponse>>();

        group.MapPost("", async (AppDbContext db, CreateProjectRequest request) =>
        {
            var created = await ProjectOperations.CreateAsync(db, request);
            return Results.Created($"/api/projects/{created.Id}", created);
        }).Produces<ProjectResponse>(StatusCodes.Status201Created);

        group.MapPut("/{id:int}", async (AppDbContext db, int id, UpdateProjectRequest request) =>
        {
            var updated = await ProjectOperations.UpdateAsync(db, id, request);
            return Results.Ok(updated);
        }).Produces<ProjectResponse>();

        group.MapDelete("/{id:int}", async (AppDbContext db, int id) =>
        {
            await ProjectOperations.DeleteAsync(db, id);
            return Results.NoContent();
        }).Produces(StatusCodes.Status204NoContent);

        return app;
    }
}
