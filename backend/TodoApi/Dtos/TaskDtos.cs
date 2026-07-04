namespace TodoApi.Dtos;

/// <summary>
/// Request body for creating a new task within a project (project comes from the route).
/// <see cref="Operations.TaskOperations.CreateAsync"/> validates <see cref="Title"/> (required,
/// max 200 chars) and <see cref="Description"/> (optional, max 2000 chars) before persisting.
/// </summary>
public class CreateTaskRequest
{
    public string? Title { get; set; }

    public string? Description { get; set; }
}

/// <summary>
/// Request body for updating an existing task's title/description. Same validation rules as
/// <see cref="CreateTaskRequest"/>.
/// </summary>
public class UpdateTaskRequest
{
    public string? Title { get; set; }

    public string? Description { get; set; }
}

/// <summary>
/// Request body for moving a task to another project.
/// </summary>
public class MoveTaskRequest
{
    public int TargetProjectId { get; set; }
}

/// <summary>
/// Request body for reordering all tasks within a project. Must contain exactly the set of task
/// IDs currently belonging to that project, in the desired new order.
/// </summary>
public class ReorderTasksRequest
{
    public List<int> OrderedTaskIds { get; set; } = new();
}

/// <summary>
/// Wire representation of a <see cref="Models.TaskItem"/>.
/// </summary>
public class TaskResponse
{
    public int Id { get; set; }

    public required string Title { get; set; }

    public string? Description { get; set; }

    public int ProjectId { get; set; }

    public int Order { get; set; }

    public bool IsComplete { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; }
}
