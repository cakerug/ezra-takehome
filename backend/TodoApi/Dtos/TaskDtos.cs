using System.ComponentModel.DataAnnotations;
using TodoApi.Models;

namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new task. <see cref="ProjectId"/> identifies the parent project
/// now that task routes are flat (<c>/api/tasks</c>, not nested under a project). <see
/// cref="Title"/>, <see cref="Description"/>, and <see cref="ProjectId"/> are all validated via
/// DataAnnotations attributes, enforced by the Minimal API validation filter (see Program.cs's
/// AddValidation call) before the handler runs.
/// </summary>
public class CreateTaskRequest
{
    // Nullable despite [Required], and deliberately not the `required` keyword, for the same
    // reason as Title below: this models untrusted wire input, where a client can omit ProjectId
    // entirely. `required` would make System.Text.Json throw on an absent property, turning a
    // clean field-level 400 into a 500.
    [Required]
    public int? ProjectId { get; set; }

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
/// Request body for <c>PATCH /api/tasks/{id}</c>. Every field is optional and independently
/// applied: a field left <c>null</c> means "leave this alone," not "clear it" -- so this single
/// request shape covers what used to be four separate endpoints (field edit, complete,
/// uncomplete, move). <see cref="IsComplete"/> and <see cref="ProjectId"/> are <c>bool?</c>/
/// <c>int?</c> specifically so "omitted" is distinguishable from an explicit value; there's no
/// equivalent way to distinguish "omitted" from "explicitly cleared" for the string fields, so
/// clearing <see cref="Description"/> means sending <c>""</c>, not <c>null</c>.
/// </summary>
public class PatchTaskRequest
{
    // MinLength(1) rather than [Required]: null must stay valid (it means "don't touch Title"),
    // but a non-null value must still be non-empty -- a task's title can be left unchanged, but
    // it can't be *set* to blank, since Title is a non-nullable domain field.
    [MinLength(1), MaxLength(FieldLengths.TaskTitle)]
    public string? Title { get; set; }

    [MaxLength(FieldLengths.TaskDescription)]
    public string? Description { get; set; }

    public bool? IsComplete { get; set; }

    public int? ProjectId { get; set; }
}

/// <summary>
/// Request body for reordering all tasks within a project. <see cref="ProjectId"/> is carried in
/// the body (rather than a route segment) now that task routes are flat. <see
/// cref="OrderedTaskIds"/> must contain exactly the set of task IDs currently belonging to that
/// project, in the desired new order.
/// </summary>
public class ReorderTasksRequest
{
    // Nullable + [Required] rather than the `required` keyword, for the same reason as
    // CreateTaskRequest's fields: a client can omit either property on the wire. [Required] rejects
    // an absent value in the validation filter as a clean field-level 400; the `required` keyword
    // would instead make System.Text.Json throw during binding, turning that into a 500.
    [Required]
    public int? ProjectId { get; set; }

    [Required]
    public List<int>? OrderedTaskIds { get; set; }
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
