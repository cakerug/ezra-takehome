using System.ComponentModel.DataAnnotations;
using TodoApi.Models;

namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new project. <see cref="Name"/> is validated (required, max
/// <see cref="FieldLengths.ProjectName"/> chars) by the Minimal API validation filter before the
/// handler runs.
/// </summary>
public class CreateProjectRequest
{
    // Nullable despite [Required], and deliberately not the `required` keyword. This models
    // untrusted wire input: a client can omit Name or send it as null, so null is a genuine
    // state of this type between binding and validation. [Required] rejects both cases in the
    // validation filter before any handler runs, which is what lets callers dereference Name
    // with `!`. The `required` keyword would instead make System.Text.Json throw on an absent
    // Name, turning a clean field-level 400 into a 500.
    [Required, MaxLength(FieldLengths.ProjectName)]
    public string? Name { get; set; }
}

/// <summary>
/// Request body for updating an existing project's name. Same validation rules as
/// <see cref="CreateProjectRequest"/>.
/// </summary>
public class UpdateProjectRequest
{
    [Required, MaxLength(FieldLengths.ProjectName)]
    public string? Name { get; set; }
}

/// <summary>
/// Request body for reordering all projects. Must contain exactly the set of project IDs that
/// currently exist, in the desired new order.
/// </summary>
public class ReorderProjectsRequest
{
    // Nullable + [Required] rather than the `required` keyword (see ReorderTasksRequest): an absent
    // list becomes a clean 400 in the validation filter instead of a 500 from a binding-time throw.
    [Required]
    public List<int>? OrderedProjectIds { get; set; }
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

    public required DateTime CreatedAt { get; set; }
}
