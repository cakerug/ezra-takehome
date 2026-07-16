using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Exceptions;
using TodoApi.Models;

namespace TodoApi.Operations;

/// <summary>
/// Plain static operations over <see cref="AppDbContext"/> for the Project resource. No
/// repository/unit-of-work abstraction and no injected service class — each method takes the
/// DbContext explicitly and is called directly by the thin endpoint handlers in
/// <see cref="TodoApi.Endpoints.ProjectEndpoints"/>.
/// </summary>
public static class ProjectOperations
{

    public static async Task<List<ProjectResponse>> ListAsync(AppDbContext db)
    {
        var projects = await db.Projects
            .OrderBy(p => p.Order)
            .ThenBy(p => p.Id)
            .ToListAsync();

        return projects.Select(ToResponse).ToList();
    }

    public static async Task<ProjectResponse> CreateAsync(AppDbContext db, CreateProjectRequest request)
    {
        var nextOrder = await NextOrderAsync(db);

        var project = new Project
        {
            Name = request.Name!,
            Order = nextOrder,
            CreatedAt = DateTime.UtcNow,
        };

        db.Projects.Add(project);
        await db.SaveChangesAsync();

        return ToResponse(project);
    }

    public static async Task<ProjectResponse> UpdateAsync(AppDbContext db, int id, UpdateProjectRequest request)
    {
        var project = await db.Projects.FindAsync(id)
            ?? throw new NotFoundException($"Project with id {id} was not found.");

        project.Name = request.Name!;

        await db.SaveChangesAsync();

        return ToResponse(project);
    }

    public static async Task DeleteAsync(AppDbContext db, int id)
    {
        var project = await db.Projects.FindAsync(id)
            ?? throw new NotFoundException($"Project with id {id} was not found.");

        // Relies on U1's FK cascade configuration (OnDelete(DeleteBehavior.Cascade) + SQLite
        // "Foreign Keys=True") to remove this project's tasks at the database level, even though
        // they are not loaded/tracked here.
        db.Projects.Remove(project);
        await db.SaveChangesAsync();
    }

    public static async Task<List<ProjectResponse>> ReorderAsync(AppDbContext db, ReorderProjectsRequest request)
    {
        var orderedIds = request.OrderedProjectIds ?? new List<int>();

        if (orderedIds.Count != orderedIds.Distinct().Count())
        {
            throw new ValidationException(
                "OrderedProjectIds",
                "The submitted project list contains duplicate IDs.");
        }

        var currentProjects = await db.Projects.ToListAsync();

        var currentIds = currentProjects.Select(p => p.Id).ToHashSet();
        var submittedIds = orderedIds.ToHashSet();

        if (!submittedIds.SetEquals(currentIds))
        {
            throw new ValidationException(
                "OrderedProjectIds",
                "The submitted project list must contain exactly the set of projects that currently exist.");
        }

        var projectsById = currentProjects.ToDictionary(p => p.Id);

        for (var i = 0; i < orderedIds.Count; i++)
        {
            projectsById[orderedIds[i]].Order = i;
        }

        await db.SaveChangesAsync();

        var reordered = orderedIds.Select(projectId => projectsById[projectId]).ToList();
        return reordered.Select(ToResponse).ToList();
    }

    private static async Task<int> NextOrderAsync(AppDbContext db)
    {
        var hasProjects = await db.Projects.AnyAsync();
        if (!hasProjects)
        {
            return 0;
        }

        var maxOrder = await db.Projects.MaxAsync(p => p.Order);
        return maxOrder + 1;
    }

    private static ProjectResponse ToResponse(Project project)
    {
        return new ProjectResponse
        {
            Id = project.Id,
            Name = project.Name,
            Order = project.Order,
            CreatedAt = project.CreatedAt,
        };
    }
}
