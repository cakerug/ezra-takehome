namespace TodoApi.Models;

public class TaskItem
{
    public int Id { get; set; }

    public required string Title { get; set; }

    public string? Description { get; set; }

    public int ProjectId { get; set; }

    public Project? Project { get; set; }

    public int Order { get; set; }

    public bool IsComplete { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; }
}
