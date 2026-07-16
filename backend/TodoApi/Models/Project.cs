namespace TodoApi.Models;

public class Project
{
    public int Id { get; set; }

    public required string Name { get; set; }

    public int Order { get; set; }

    // Nothing reads this yet. It exists because creation time is only recordable at creation:
    // once a project is saved without it, its age is unrecoverable. Mirrors TaskItem.CreatedAt.
    public DateTime CreatedAt { get; set; }

    public List<TaskItem> Tasks { get; set; } = new();
}
