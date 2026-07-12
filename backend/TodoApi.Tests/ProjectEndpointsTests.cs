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
        });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        Assert.Equal("Groceries", created!.Name);
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
        });
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(updated);
        Assert.Equal("Groceries & Household", updated!.Name);
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
    public async Task DeletingFormerlyDefaultInboxProject_IsAllowedAndCascadesToItsTasks()
    {
        // The "default project" concept is gone: every project, including one named "Inbox",
        // deletes like any other and its tasks cascade away.
        int inboxId;
        int taskId;
        using (var db = CreateDirectDbContext())
        {
            var inbox = new Project { Name = "Inbox", Order = 0 };
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

        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using (var verifyDb = CreateDirectDbContext())
        {
            Assert.Null(verifyDb.Projects.SingleOrDefault(p => p.Id == inboxId));
            Assert.Null(verifyDb.Tasks.SingleOrDefault(t => t.Id == taskId));
        }
    }

    [Fact]
    public async Task DeletingProjectWithTasks_CascadesAndRemovesTasksToo()
    {
        int projectId;
        int task1Id;
        int task2Id;
        using (var db = CreateDirectDbContext())
        {
            var project = new Project { Name = "Home Renovation", Order = 0 };
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
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // The test database is migrated + seeded on startup, so a few projects already exist. These
    // tests assert on newly-created projects relative to the seeded ones rather than assuming an
    // empty table.

    [Fact]
    public async Task CreatedProjects_ReceiveIncrementingOrderAndListAfterExistingOnes()
    {
        var client = _factory.CreateClient();

        var first = await CreateProjectAsync(client, "First");
        var second = await CreateProjectAsync(client, "Second");

        // Each new project's Order is the previous max + 1, so they sort strictly after the
        // seeded ones and preserve creation order among themselves.
        Assert.True(first.Order < second.Order);

        var list = await ListProjectsAsync(client);
        var ids = list.Select(p => p.Id).ToList();
        Assert.True(ids.IndexOf(first.Id) < ids.IndexOf(second.Id));
        // List is returned sorted by Order.
        var orders = list.Select(p => p.Order).ToList();
        Assert.Equal(orders.OrderBy(o => o).ToList(), orders);
    }

    [Fact]
    public async Task FullReorderRoundTrip_ReversesTheProjectListExactly()
    {
        var client = _factory.CreateClient();

        // Include the seeded projects so the request covers exactly the full current set.
        await CreateProjectAsync(client, "A");
        await CreateProjectAsync(client, "B");

        var before = await ListProjectsAsync(client);
        var newOrder = before.Select(p => p.Id).Reverse().ToList();

        var reorderResponse = await client.PutAsJsonAsync("/api/projects/reorder", new ReorderProjectsRequest
        {
            OrderedProjectIds = newOrder,
        });
        Assert.Equal(HttpStatusCode.OK, reorderResponse.StatusCode);
        var reordered = await reorderResponse.Content.ReadFromJsonAsync<List<ProjectResponse>>();
        Assert.NotNull(reordered);
        Assert.Equal(newOrder, reordered!.Select(p => p.Id).ToList());
        // Order values are re-densified to 0..n-1 in the new sequence.
        Assert.Equal(Enumerable.Range(0, newOrder.Count).ToList(), reordered.Select(p => p.Order).ToList());

        // Confirm via a fresh list call (queried by Order) that persisted state matches.
        var list = await ListProjectsAsync(client);
        Assert.Equal(newOrder, list.Select(p => p.Id).ToList());
    }

    [Fact]
    public async Task ReorderOmittingAnExistingProjectId_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        await CreateProjectAsync(client, "A");
        var before = await ListProjectsAsync(client);

        var response = await client.PutAsJsonAsync("/api/projects/reorder", new ReorderProjectsRequest
        {
            OrderedProjectIds = before.Select(p => p.Id).Skip(1).ToList(), // omits one existing id
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // Confirm nothing was mutated.
        var after = await ListProjectsAsync(client);
        Assert.Equal(before.Select(p => p.Id).ToList(), after.Select(p => p.Id).ToList());
    }

    [Fact]
    public async Task ReorderWithDuplicateProjectId_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var a = await CreateProjectAsync(client, "A");
        var before = await ListProjectsAsync(client);

        // Duplicate one id and drop another so the count still matches but the set doesn't.
        var ids = before.Select(p => p.Id).ToList();
        ids[0] = a.Id;
        ids[ids.Count - 1] = a.Id;

        var response = await client.PutAsJsonAsync("/api/projects/reorder", new ReorderProjectsRequest
        {
            OrderedProjectIds = ids,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<ProjectResponse> CreateProjectAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest { Name = name });
        response.EnsureSuccessStatusCode();
        var created = await response.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        return created!;
    }

    private static async Task<List<ProjectResponse>> ListProjectsAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/projects");
        response.EnsureSuccessStatusCode();
        var list = await response.Content.ReadFromJsonAsync<List<ProjectResponse>>();
        Assert.NotNull(list);
        return list!;
    }
}
