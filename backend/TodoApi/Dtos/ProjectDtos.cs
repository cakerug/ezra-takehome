namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new project. <see cref="Operations.ProjectOperations.CreateAsync"/>
/// validates <see cref="Name"/> (required, max 200 chars) and <see cref="Description"/> (optional,
/// max 2000 chars) before persisting.
/// </summary>
public class CreateProjectRequest
{
    public string? Name { get; set; }

    public string? Description { get; set; }
}

/// <summary>
/// Request body for updating an existing project's name/description. Same validation rules as
/// <see cref="CreateProjectRequest"/>.
/// </summary>
public class UpdateProjectRequest
{
    public string? Name { get; set; }

    public string? Description { get; set; }
}

/// <summary>
/// Wire representation of a <see cref="Models.Project"/>. Deliberately excludes the Tasks
/// navigation property — endpoints in this unit only need project-level fields.
/// </summary>
public class ProjectResponse
{
    public required int Id { get; set; }

    public required string Name { get; set; }

    public string? Description { get; set; }

    public required bool IsDefault { get; set; }
}
