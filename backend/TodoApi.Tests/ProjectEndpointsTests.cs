using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TodoApi.Data;
using TodoApi.Dtos;
using TodoApi.Models;

namespace TodoApi.Tests;

/// <summary>
/// Integration tests for the Project CRUD endpoints, run against a real temp-file SQLite
/// database (not the EF Core InMemory provider) so that FK cascade-delete behavior (R10) is
/// actually exercised at the database level, matching U1's precedent in DataModelTests.
///
/// Each test gets its own WebApplicationFactory pointed at its own temp-file database via
/// WithWebHostBuilder + ConfigureServices, so tests never share state or interfere with each
/// other. The temp file is deleted on dispose.
/// </summary>
public class ProjectEndpointsTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _connectionString;
    private readonly WebApplicationFactory<Program> _factory;

    public ProjectEndpointsTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"todoapi-project-test-{Guid.NewGuid()}.db");
        _connectionString = $"Data Source={_dbPath};Foreign Keys=True";

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options =>
                    options.UseSqlite(_connectionString));
            });
        });

        // Force the app's startup (which runs db.Database.Migrate()) to materialize the schema
        // in our temp file before any test issues requests.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _factory.Dispose();
        SqliteConnection.ClearAllPools();
        if (File.Exists(_dbPath))
        {
            File.Delete(_dbPath);
        }
    }

    private AppDbContext CreateDirectDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connectionString)
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public async Task HappyPath_CreateListEditDelete_WorksEndToEnd()
    {
        var client = _factory.CreateClient();

        // Create
        var createResponse = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest
        {
            Name = "Groceries",
            Description = "Weekly shopping list",
        });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        Assert.Equal("Groceries", created!.Name);
        Assert.Equal("Weekly shopping list", created.Description);
        Assert.False(created.IsDefault);
        Assert.True(created.Id > 0);

        // List
        var listResponse = await client.GetAsync("/api/projects");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<List<ProjectResponse>>();
        Assert.NotNull(list);
        Assert.Contains(list!, p => p.Id == created.Id && p.Name == "Groceries");

        // Edit
        var updateResponse = await client.PutAsJsonAsync($"/api/projects/{created.Id}", new UpdateProjectRequest
        {
            Name = "Groceries & Household",
            Description = "Updated list",
        });
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(updated);
        Assert.Equal("Groceries & Household", updated!.Name);
        Assert.Equal("Updated list", updated.Description);
        Assert.Equal(created.Id, updated.Id);

        // Delete
        var deleteResponse = await client.DeleteAsync($"/api/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        // Confirm it's gone
        var listAfterDelete = await client.GetAsync("/api/projects");
        var listAfterDeleteBody = await listAfterDelete.Content.ReadFromJsonAsync<List<ProjectResponse>>();
        Assert.DoesNotContain(listAfterDeleteBody!, p => p.Id == created.Id);
    }

    [Fact]
    public async Task DeletingDefaultInboxProject_Returns403AndLeavesItAndItsTasksIntact()
    {
        // Seeding doesn't exist yet (that's U5), so manually insert a project with
        // IsDefault = true here to exercise the guard, plus a task under it, to prove the
        // guard fires BEFORE any deletion/cascade happens.
        int inboxId;
        int taskId;
        using (var db = CreateDirectDbContext())
        {
            var inbox = new Project { Name = "Inbox", Description = null, IsDefault = true };
            db.Projects.Add(inbox);
            db.SaveChanges();
            inboxId = inbox.Id;

            var task = new TaskItem
            {
                Title = "Some task",
                ProjectId = inbox.Id,
                Order = 0,
                CreatedAt = DateTime.UtcNow,
            };
            db.Tasks.Add(task);
            db.SaveChanges();
            taskId = task.Id;
        }

        var client = _factory.CreateClient();

        var deleteResponse = await client.DeleteAsync($"/api/projects/{inboxId}");

        Assert.Equal(HttpStatusCode.Forbidden, deleteResponse.StatusCode);

        using (var verifyDb = CreateDirectDbContext())
        {
            var stillThere = verifyDb.Projects.SingleOrDefault(p => p.Id == inboxId);
            Assert.NotNull(stillThere);
            Assert.True(stillThere!.IsDefault);

            var taskStillThere = verifyDb.Tasks.SingleOrDefault(t => t.Id == taskId);
            Assert.NotNull(taskStillThere);
        }
    }

    [Fact]
    public async Task DeletingNonDefaultProjectWithTasks_CascadesAndRemovesTasksToo()
    {
        int projectId;
        int task1Id;
        int task2Id;
        using (var db = CreateDirectDbContext())
        {
            var project = new Project { Name = "Home Renovation", Description = null, IsDefault = false };
            db.Projects.Add(project);
            db.SaveChanges();
            projectId = project.Id;

            var task1 = new TaskItem { Title = "Paint fence", ProjectId = project.Id, Order = 0, CreatedAt = DateTime.UtcNow };
            var task2 = new TaskItem { Title = "Fix gutter", ProjectId = project.Id, Order = 1, CreatedAt = DateTime.UtcNow };
            db.Tasks.AddRange(task1, task2);
            db.SaveChanges();
            task1Id = task1.Id;
            task2Id = task2.Id;
        }

        var client = _factory.CreateClient();

        var deleteResponse = await client.DeleteAsync($"/api/projects/{projectId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using (var verifyDb = CreateDirectDbContext())
        {
            Assert.Null(verifyDb.Projects.SingleOrDefault(p => p.Id == projectId));
            Assert.Null(verifyDb.Tasks.SingleOrDefault(t => t.Id == task1Id));
            Assert.Null(verifyDb.Tasks.SingleOrDefault(t => t.Id == task2Id));
        }
    }

    [Fact]
    public async Task CreatingProjectWithEmptyName_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest
        {
            Name = "",
            Description = "Doesn't matter",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatingProjectWithNameExceeding200Characters_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest
        {
            Name = new string('a', 201),
            Description = null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatingProjectWithDescriptionExceeding2000Characters_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest
        {
            Name = "Some project",
            Description = new string('a', 2001),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.NotNull(problem);
        Assert.Contains("Description", problem!.Errors.Keys);
    }
}
