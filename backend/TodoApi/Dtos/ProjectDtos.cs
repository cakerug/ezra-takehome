namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new project. <see cref="Operations.ProjectOperations.CreateAsync"/>
/// validates <see cref="Name"/> (required, max 200 chars) before persisting.
/// </summary>
public class CreateProjectRequest
{
    public string? Name { get; set; }
}

/// <summary>
/// Request body for updating an existing project's name. Same validation rules as
/// <see cref="CreateProjectRequest"/>.
/// </summary>
public class UpdateProjectRequest
{
    public string? Name { get; set; }
}

/// <summary>
/// Request body for reordering all projects. Must contain exactly the set of project IDs that
/// currently exist, in the desired new order.
/// </summary>
public class ReorderProjectsRequest
{
    public required List<int> OrderedProjectIds { get; set; } = new();
}

/// <summary>
/// Wire representation of a <see cref="Models.Project"/>. Deliberately excludes the Tasks
/// navigation property — endpoints in this unit only need project-level fields.
/// </summary>
public class ProjectResponse
{
    public required int Id { get; set; }

    public required string Name { get; set; }

    public required int Order { get; set; }
}
