using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TodoApi.Data;

namespace TodoApi.Tests;

/// <summary>
/// Exercises <see cref="DbSeeder"/> directly against an <see cref="AppDbContext"/> backed by a
/// real temp-file SQLite database (matching DataModelTests's precedent), rather than going
/// through the full WebApplicationFactory/HTTP pipeline — SeedAsync is called directly, so no
/// HTTP layer is involved.
/// </summary>
public class DbSeederTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _connectionString;

    public DbSeederTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"todoapi-seeder-test-{Guid.NewGuid()}.db");
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
    public async Task SeedAsync_AgainstFreshDatabase_CreatesSeveralOrderedProjectsWithExampleData()
    {
        using (var db = CreateContext())
        {
            await DbSeeder.SeedAsync(db);
        }

        using var verifyDb = CreateContext();

        var projects = verifyDb.Projects.ToList();
        var tasks = verifyDb.Tasks.ToList();

        Assert.True(projects.Count >= 2, "Expected several example projects to be seeded.");

        // Projects seed with distinct Order values so the sidebar has a stable initial order.
        var orders = projects.Select(p => p.Order).OrderBy(o => o).ToList();
        Assert.Equal(orders.Count, orders.Distinct().Count());
        Assert.Contains(projects, p => p.Name == "Inbox");

        Assert.NotEmpty(tasks);
        Assert.All(tasks, t => Assert.True(t.ProjectId > 0));

        // Every project's tasks should start Order at 0.
        foreach (var project in projects)
        {
            var projectTasks = tasks.Where(t => t.ProjectId == project.Id).OrderBy(t => t.Order).ToList();
            if (projectTasks.Count > 0)
            {
                Assert.Equal(0, projectTasks[0].Order);
            }
        }

        // A mix of complete/incomplete tasks exists somewhere in the seed data.
        Assert.Contains(tasks, t => t.IsComplete);
        Assert.Contains(tasks, t => !t.IsComplete);
    }

    [Fact]
    public async Task SeedAsync_CalledTwice_IsANoOp_NoDuplicateProjectsOrTasks()
    {
        using (var db = CreateContext())
        {
            await DbSeeder.SeedAsync(db);
        }

        int projectCountAfterFirstSeed;
        int taskCountAfterFirstSeed;
        using (var db = CreateContext())
        {
            projectCountAfterFirstSeed = db.Projects.Count();
            taskCountAfterFirstSeed = db.Tasks.Count();
        }

        using (var db = CreateContext())
        {
            await DbSeeder.SeedAsync(db);
        }

        using var verifyDb = CreateContext();
        var projectCountAfterSecondSeed = verifyDb.Projects.Count();
        var taskCountAfterSecondSeed = verifyDb.Tasks.Count();

        Assert.Equal(projectCountAfterFirstSeed, projectCountAfterSecondSeed);
        Assert.Equal(taskCountAfterFirstSeed, taskCountAfterSecondSeed);
    }
}
