using System.ComponentModel.DataAnnotations;
using TodoApi.Models;

namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new task within a project (project comes from the route).
/// <see cref="Title"/> and <see cref="Description"/> are validated via DataAnnotations
/// attributes, enforced by the Minimal API validation filter (see Program.cs's AddValidation
/// call) before the handler runs.
/// </summary>
public class CreateTaskRequest
{
    // Nullable despite [Required], and deliberately not the `required` keyword. This models
    // untrusted wire input: a client can omit Title or send it as null, so null is a genuine
    // state of this type between binding and validation. [Required] rejects both cases in the
    // validation filter before any handler runs, which is what lets callers dereference Title
    // with `!`. The `required` keyword would instead make System.Text.Json throw on an absent
    // Title, turning a clean field-level 400 into a 500.
    [Required, MaxLength(FieldLengths.TaskTitle)]
    public string? Title { get; set; }

    [MaxLength(FieldLengths.TaskDescription)]
    public string? Description { get; set; }
}

/// <summary>
/// Request body for updating an existing task's title/description. Same validation rules as
/// <see cref="CreateTaskRequest"/>.
/// </summary>
public class UpdateTaskRequest
{
    [Required, MaxLength(FieldLengths.TaskTitle)]
    public string? Title { get; set; }

    [MaxLength(FieldLengths.TaskDescription)]
    public string? Description { get; set; }
}

/// <summary>
/// Request body for moving a task to another project.
/// </summary>
public class MoveTaskRequest
{
    public required int TargetProjectId { get; set; }
}

/// <summary>
/// Request body for reordering all tasks within a project. Must contain exactly the set of task
/// IDs currently belonging to that project, in the desired new order.
/// </summary>
public class ReorderTasksRequest
{
    public required List<int> OrderedTaskIds { get; set; } = new();
}

/// <summary>
/// Wire representation of a <see cref="Models.TaskItem"/>.
/// </summary>
public class TaskResponse
{
    public required int Id { get; set; }

    public required string Title { get; set; }

    public string? Description { get; set; }

    public required int ProjectId { get; set; }

    public required int Order { get; set; }

    public required bool IsComplete { get; set; }

    public DateTime? CompletedAt { get; set; }

    public required DateTime CreatedAt { get; set; }
}
