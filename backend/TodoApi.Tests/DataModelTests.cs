using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Models;

namespace TodoApi.Tests;

/// <summary>
/// Exercises the EF Core data model against a REAL SQLite database (a temp file), not the
/// EF Core InMemory provider for testing. InMemory does not model foreign-key constraints or cascade
/// behavior at all, so it would give a false-positive pass here regardless of whether the
/// "Foreign Keys=True" pragma is actually wired up correctly.
/// 
/// SQLite has FK enforcement OFF by default per-connection, and EF Core's cascade-delete only
/// cascades for in-memory entities already tracked in the current DbContext, and defers to the
/// db's behavior for the task rows not loaded in memory. If you miss the "Foreign Keys=True" pragma,
/// that may silently orphan task rows with no error thrown.
/// </summary>
public class DataModelTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _connectionString;

    public DataModelTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"todoapi-test-{Guid.NewGuid()}.db");
        _connectionString = $"Data Source={_dbPath};Foreign Keys=True";

        using var context = CreateContext();
        context.Database.EnsureCreated();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (File.Exists(_dbPath))
        {
            File.Delete(_dbPath);
        }
    }

    private AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connectionString)
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public void ForeignKeyEnforcement_IsOnForRealConnection()
    {
        // Direct assertion that PRAGMA foreign_keys reports on for connections opened with our
        // connection string, so a future regression (e.g. someone removing "Foreign Keys=True")
        // is caught immediately by this test rather than only inferred from the cascade test.
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_keys;";
        var result = (long)command.ExecuteScalar()!;

        Assert.Equal(1, result);
    }

    [Fact]
    public void DeletingProject_WithTasksNotLoaded_CascadesToDeleteTasksAtTheDatabaseLevel()
    {
        // This is the important test. It exercises the exact path that silently fails without
        // FK enforcement enabled at the SQLite connection level: deleting a project via a
        // context that never queried/tracked its tasks. EF Core has no in-memory task graph to
        // cascade through here, so the only thing that can remove the child rows is the
        // database's own ON DELETE CASCADE — which SQLite only honors if "PRAGMA foreign_keys"
        // is on for that connection.
        int projectId;

        using (var setupContext = CreateContext())
        {
            var project = new Project { Name = "Ephemeral", Order = 0 };
            setupContext.Projects.Add(project);
            setupContext.SaveChanges();
            projectId = project.Id;

            setupContext.Tasks.AddRange(
                new TaskItem { Title = "Task 1", ProjectId = project.Id, Order = 0, CreatedAt = DateTime.UtcNow },
                new TaskItem { Title = "Task 2", ProjectId = project.Id, Order = 1, CreatedAt = DateTime.UtcNow }
            );
            setupContext.SaveChanges();
        }

        // Fresh DbContext instance: it has never loaded this project's tasks, so its change
        // tracker has no knowledge of them at all.
        using (var deleteContext = CreateContext())
        {
            var project = deleteContext.Projects.Single(p => p.Id == projectId);
            deleteContext.Projects.Remove(project);
            deleteContext.SaveChanges();
        }

        // Verify via a third, fresh context/connection that no orphaned task rows remain.
        using (var verifyContext = CreateContext())
        {
            var orphanedTasks = verifyContext.Tasks.Where(t => t.ProjectId == projectId).ToList();
            Assert.Empty(orphanedTasks);
            Assert.Null(verifyContext.Projects.SingleOrDefault(p => p.Id == projectId));
        }
    }
}
