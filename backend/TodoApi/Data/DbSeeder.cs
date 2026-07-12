using Microsoft.EntityFrameworkCore;
using TodoApi.Models;

namespace TodoApi.Data;

/// <summary>
/// Seeds a fresh database with example data (R15): a few ordinary projects, each with a handful
/// of tasks. Idempotent: if any project already exists, <see cref="SeedAsync"/> is a no-op, so it
/// is safe to call on every startup against a persisted SQLite file without creating duplicates.
/// </summary>
public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.Projects.AnyAsync())
        {
            return;
        }

        var now = DateTime.UtcNow;

        var inbox = new Project
        {
            Name = "Inbox",
            Description = "A place to jot down tasks before sorting them into projects.",
            Order = 0,
            Tasks = new List<TaskItem>
            {
                new() { Title = "Welcome to your to-do app!", Order = 0, IsComplete = false, CreatedAt = now },
                new() { Title = "Try creating a new project", Order = 1, IsComplete = false, CreatedAt = now },
                new()
                {
                    Title = "Explore the Swagger docs at /swagger",
                    Order = 2,
                    IsComplete = true,
                    CompletedAt = now,
                    CreatedAt = now,
                },
            },
        };

        var personal = new Project
        {
            Name = "Personal",
            Description = "Errands, chores, and other personal to-dos.",
            Order = 1,
            Tasks = new List<TaskItem>
            {
                new() { Title = "Buy groceries", Order = 0, IsComplete = false, CreatedAt = now },
                new()
                {
                    Title = "Schedule dentist appointment",
                    Order = 1,
                    IsComplete = false,
                    CreatedAt = now,
                },
                new()
                {
                    Title = "Renew library books",
                    Order = 2,
                    IsComplete = true,
                    CompletedAt = now,
                    CreatedAt = now,
                },
            },
        };

        var work = new Project
        {
            Name = "Work",
            Description = "Tasks related to your job.",
            Order = 2,
            Tasks = new List<TaskItem>
            {
                new() { Title = "Prepare sprint planning notes", Order = 0, IsComplete = false, CreatedAt = now },
                new()
                {
                    Title = "Review pull requests",
                    Order = 1,
                    IsComplete = true,
                    CompletedAt = now,
                    CreatedAt = now,
                },
            },
        };

        db.Projects.AddRange(inbox, personal, work);
        await db.SaveChangesAsync();
    }
}
