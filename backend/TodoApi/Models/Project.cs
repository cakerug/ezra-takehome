namespace TodoApi.Models;

public class Project
{
    public int Id { get; set; }

    public required string Name { get; set; }

    public int Order { get; set; }

    public List<TaskItem> Tasks { get; set; } = new();
}
