using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Exceptions;
using TodoApi.Models;
using TodoApi.Validation;

namespace TodoApi.Operations;

/// <summary>
/// Plain static operations over <see cref="AppDbContext"/> for the Project resource. No
/// repository/unit-of-work abstraction and no injected service class — each method takes the
/// DbContext explicitly and is called directly by the thin endpoint handlers in
/// <see cref="TodoApi.Endpoints.ProjectEndpoints"/>.
/// </summary>
public static class ProjectOperations
{
    private const int NameMaxLength = 200;
    private const int DescriptionMaxLength = 2000;

    public static async Task<List<ProjectResponse>> ListAsync(AppDbContext db)
    {
        var projects = await db.Projects
            .OrderBy(p => p.Id)
            .ToListAsync();

        return projects.Select(ToResponse).ToList();
    }

    public static async Task<ProjectResponse> CreateAsync(AppDbContext db, CreateProjectRequest request)
    {
        FieldValidation.EnsureRequiredWithMaxLength(request.Name, NameMaxLength, "Name");
        FieldValidation.EnsureMaxLength(request.Description, DescriptionMaxLength, "Description");

        var project = new Project
        {
            Name = request.Name!,
            Description = request.Description,
            IsDefault = false,
        };

        db.Projects.Add(project);
        await db.SaveChangesAsync();

        return ToResponse(project);
    }

    public static async Task<ProjectResponse> UpdateAsync(AppDbContext db, int id, UpdateProjectRequest request)
    {
        FieldValidation.EnsureRequiredWithMaxLength(request.Name, NameMaxLength, "Name");
        FieldValidation.EnsureMaxLength(request.Description, DescriptionMaxLength, "Description");

        var project = await db.Projects.FindAsync(id)
            ?? throw new NotFoundException($"Project with id {id} was not found.");

        project.Name = request.Name!;
        project.Description = request.Description;

        await db.SaveChangesAsync();

        return ToResponse(project);
    }

    public static async Task DeleteAsync(AppDbContext db, int id)
    {
        var project = await db.Projects.FindAsync(id)
            ?? throw new NotFoundException($"Project with id {id} was not found.");

        if (project.IsDefault)
        {
            throw new ForbiddenOperationException("The default Inbox project cannot be deleted.");
        }

        // Relies on U1's FK cascade configuration (OnDelete(DeleteBehavior.Cascade) + SQLite
        // "Foreign Keys=True") to remove this project's tasks at the database level, even though
        // they are not loaded/tracked here.
        db.Projects.Remove(project);
        await db.SaveChangesAsync();
    }

    private static ProjectResponse ToResponse(Project project)
    {
        return new ProjectResponse
        {
            Id = project.Id,
            Name = project.Name,
            Description = project.Description,
            IsDefault = project.IsDefault,
        };
    }
}
