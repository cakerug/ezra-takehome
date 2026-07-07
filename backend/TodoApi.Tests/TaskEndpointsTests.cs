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
/// Integration tests for the Task endpoints (CRUD, complete/uncomplete, move, reorder), run
/// against a real temp-file SQLite database, matching the WebApplicationFactory pattern
/// established in ProjectEndpointsTests.
///
/// Each test gets its own WebApplicationFactory pointed at its own temp-file database via
/// WithWebHostBuilder + ConfigureServices, so tests never share state or interfere with each
/// other. The temp file is deleted on dispose.
/// </summary>
public class TaskEndpointsTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _connectionString;
    private readonly WebApplicationFactory<Program> _factory;

    public TaskEndpointsTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"todoapi-task-test-{Guid.NewGuid()}.db");
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

    private async Task<int> CreateProjectAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/projects", new CreateProjectRequest { Name = name });
        response.EnsureSuccessStatusCode();
        var project = await response.Content.ReadFromJsonAsync<ProjectResponse>();
        return project!.Id;
    }

    private async Task<TaskResponse> CreateTaskAsync(HttpClient client, int projectId, string title)
    {
        var response = await client.PostAsJsonAsync($"/api/projects/{projectId}/tasks", new CreateTaskRequest { Title = title });
        response.EnsureSuccessStatusCode();
        var task = await response.Content.ReadFromJsonAsync<TaskResponse>();
        return task!;
    }

    // ---------------------------------------------------------------------
    // Move + reorder scenarios first, per the plan's execution note: these
    // are the fiddliest logic (order bookkeeping) and most likely to hide an
    // off-by-one or stale-order bug.
    // ---------------------------------------------------------------------

    [Fact]
    public async Task MovingTask_UpdatesProjectAndAppendsToDestinationOrder_LeavesSourceOrderUntouched()
    {
        var client = _factory.CreateClient();

        var sourceProjectId = await CreateProjectAsync(client, "Source");
        var destProjectId = await CreateProjectAsync(client, "Destination");

        // Source project: 3 tasks, Order 0, 1, 2.
        var sourceTask0 = await CreateTaskAsync(client, sourceProjectId, "Source Task 0");
        var sourceTask1 = await CreateTaskAsync(client, sourceProjectId, "Source Task 1");
        var sourceTask2 = await CreateTaskAsync(client, sourceProjectId, "Source Task 2");

        // Destination project already has 2 tasks, Order 0, 1 -- so the moved task should land
        // at Order 2.
        var destTask0 = await CreateTaskAsync(client, destProjectId, "Dest Task 0");
        var destTask1 = await CreateTaskAsync(client, destProjectId, "Dest Task 1");

        // Move the middle source task (Order 1) to the destination project.
        var moveResponse = await client.PutAsJsonAsync($"/api/tasks/{sourceTask1.Id}/move", new MoveTaskRequest
        {
            TargetProjectId = destProjectId,
        });
        Assert.Equal(HttpStatusCode.OK, moveResponse.StatusCode);
        var moved = await moveResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(moved);
        Assert.Equal(destProjectId, moved!.ProjectId);
        Assert.Equal(2, moved.Order); // appended after destTask0 (0) and destTask1 (1)

        // Source project's remaining tasks (Order 0 and Order 2) must keep their exact prior
        // relative order -- untouched, not compacted/renumbered.
        using var db = CreateDirectDbContext();
        var remainingSourceTask0 = db.Tasks.Single(t => t.Id == sourceTask0.Id);
        var remainingSourceTask2 = db.Tasks.Single(t => t.Id == sourceTask2.Id);
        Assert.Equal(0, remainingSourceTask0.Order);
        Assert.Equal(sourceProjectId, remainingSourceTask0.ProjectId);
        Assert.Equal(2, remainingSourceTask2.Order);
        Assert.Equal(sourceProjectId, remainingSourceTask2.ProjectId);

        // Destination project's pre-existing tasks are untouched too.
        var remainingDestTask0 = db.Tasks.Single(t => t.Id == destTask0.Id);
        var remainingDestTask1 = db.Tasks.Single(t => t.Id == destTask1.Id);
        Assert.Equal(0, remainingDestTask0.Order);
        Assert.Equal(1, remainingDestTask1.Order);

        // The moved task itself, re-read from the DB, confirms persisted state.
        var movedFromDb = db.Tasks.Single(t => t.Id == sourceTask1.Id);
        Assert.Equal(destProjectId, movedFromDb.ProjectId);
        Assert.Equal(2, movedFromDb.Order);
    }

    [Fact]
    public async Task MovingTaskToEmptyProject_AppendsAtOrderZero()
    {
        var client = _factory.CreateClient();

        var sourceProjectId = await CreateProjectAsync(client, "Source");
        var emptyDestProjectId = await CreateProjectAsync(client, "Empty Destination");

        var task = await CreateTaskAsync(client, sourceProjectId, "Only Task");

        var moveResponse = await client.PutAsJsonAsync($"/api/tasks/{task.Id}/move", new MoveTaskRequest
        {
            TargetProjectId = emptyDestProjectId,
        });
        Assert.Equal(HttpStatusCode.OK, moveResponse.StatusCode);
        var moved = await moveResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(moved);
        Assert.Equal(emptyDestProjectId, moved!.ProjectId);
        Assert.Equal(0, moved.Order);
    }

    [Fact]
    public async Task MovingTaskToNonexistentProject_Returns404()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Source");
        var task = await CreateTaskAsync(client, projectId, "Some Task");

        var moveResponse = await client.PutAsJsonAsync($"/api/tasks/{task.Id}/move", new MoveTaskRequest
        {
            TargetProjectId = 999999,
        });

        Assert.Equal(HttpStatusCode.NotFound, moveResponse.StatusCode);
    }

    [Fact]
    public async Task FullReorderRoundTrip_ThreeTasks_MatchesNewSequenceExactly()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Reorder Project");

        var taskA = await CreateTaskAsync(client, projectId, "A"); // Order 0
        var taskB = await CreateTaskAsync(client, projectId, "B"); // Order 1
        var taskC = await CreateTaskAsync(client, projectId, "C"); // Order 2

        // New sequence: C, A, B
        var newOrder = new List<int> { taskC.Id, taskA.Id, taskB.Id };

        var reorderResponse = await client.PutAsJsonAsync($"/api/projects/{projectId}/tasks/reorder", new ReorderTasksRequest
        {
            OrderedTaskIds = newOrder,
        });
        Assert.Equal(HttpStatusCode.OK, reorderResponse.StatusCode);
        var reordered = await reorderResponse.Content.ReadFromJsonAsync<List<TaskResponse>>();
        Assert.NotNull(reordered);
        Assert.Equal(newOrder, reordered!.Select(t => t.Id).ToList());
        Assert.Equal(new List<int> { 0, 1, 2 }, reordered.Select(t => t.Order).ToList());

        // Confirm via a fresh list call (queried by Order) that persisted state matches.
        var listResponse = await client.GetAsync($"/api/projects/{projectId}/tasks");
        var list = await listResponse.Content.ReadFromJsonAsync<List<TaskResponse>>();
        Assert.NotNull(list);
        Assert.Equal(newOrder, list!.Select(t => t.Id).ToList());

        using var db = CreateDirectDbContext();
        Assert.Equal(0, db.Tasks.Single(t => t.Id == taskC.Id).Order);
        Assert.Equal(1, db.Tasks.Single(t => t.Id == taskA.Id).Order);
        Assert.Equal(2, db.Tasks.Single(t => t.Id == taskB.Id).Order);
    }

    [Fact]
    public async Task ReorderOmittingAnExistingTaskId_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");
        var taskA = await CreateTaskAsync(client, projectId, "A");
        var taskB = await CreateTaskAsync(client, projectId, "B");

        var response = await client.PutAsJsonAsync($"/api/projects/{projectId}/tasks/reorder", new ReorderTasksRequest
        {
            OrderedTaskIds = new List<int> { taskA.Id }, // omits taskB
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // Confirm nothing was mutated.
        using var db = CreateDirectDbContext();
        Assert.Equal(0, db.Tasks.Single(t => t.Id == taskA.Id).Order);
        Assert.Equal(1, db.Tasks.Single(t => t.Id == taskB.Id).Order);
    }

    [Fact]
    public async Task ReorderWithDuplicateTaskId_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");
        var taskA = await CreateTaskAsync(client, projectId, "A");
        var taskB = await CreateTaskAsync(client, projectId, "B");

        var response = await client.PutAsJsonAsync($"/api/projects/{projectId}/tasks/reorder", new ReorderTasksRequest
        {
            OrderedTaskIds = new List<int> { taskA.Id, taskA.Id }, // duplicate, omits taskB
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ReorderWithTaskIdFromDifferentProject_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");
        var otherProjectId = await CreateProjectAsync(client, "Other Project");

        var taskA = await CreateTaskAsync(client, projectId, "A");
        var taskB = await CreateTaskAsync(client, projectId, "B");
        var otherTask = await CreateTaskAsync(client, otherProjectId, "Other");

        var response = await client.PutAsJsonAsync($"/api/projects/{projectId}/tasks/reorder", new ReorderTasksRequest
        {
            OrderedTaskIds = new List<int> { taskA.Id, otherTask.Id }, // otherTask doesn't belong; also omits taskB
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // Confirm the other project's task was not reassigned into this project.
        using var db = CreateDirectDbContext();
        var otherTaskFromDb = db.Tasks.Single(t => t.Id == otherTask.Id);
        Assert.Equal(otherProjectId, otherTaskFromDb.ProjectId);
    }

    [Fact]
    public async Task MoveThenReorderSequence_ResultsInConsistentFinalState()
    {
        var client = _factory.CreateClient();

        var projectAId = await CreateProjectAsync(client, "Project A");
        var projectBId = await CreateProjectAsync(client, "Project B");

        var a0 = await CreateTaskAsync(client, projectAId, "A0");
        var a1 = await CreateTaskAsync(client, projectAId, "A1");

        var b0 = await CreateTaskAsync(client, projectBId, "B0");
        var b1 = await CreateTaskAsync(client, projectBId, "B1");

        // Move a1 into Project B -- should land at Order 2 (after b0=0, b1=1).
        var moveResponse = await client.PutAsJsonAsync($"/api/tasks/{a1.Id}/move", new MoveTaskRequest
        {
            TargetProjectId = projectBId,
        });
        Assert.Equal(HttpStatusCode.OK, moveResponse.StatusCode);
        var moved = await moveResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.Equal(2, moved!.Order);

        // Now reorder Project B's tasks (b0, b1, a1) into (a1, b1, b0).
        var newOrder = new List<int> { a1.Id, b1.Id, b0.Id };
        var reorderResponse = await client.PutAsJsonAsync($"/api/projects/{projectBId}/tasks/reorder", new ReorderTasksRequest
        {
            OrderedTaskIds = newOrder,
        });
        Assert.Equal(HttpStatusCode.OK, reorderResponse.StatusCode);

        using var db = CreateDirectDbContext();
        Assert.Equal(0, db.Tasks.Single(t => t.Id == a1.Id).Order);
        Assert.Equal(1, db.Tasks.Single(t => t.Id == b1.Id).Order);
        Assert.Equal(2, db.Tasks.Single(t => t.Id == b0.Id).Order);
        Assert.Equal(projectBId, db.Tasks.Single(t => t.Id == a1.Id).ProjectId);

        // Project A's remaining task (a0) is untouched.
        Assert.Equal(0, db.Tasks.Single(t => t.Id == a0.Id).Order);
        Assert.Equal(projectAId, db.Tasks.Single(t => t.Id == a0.Id).ProjectId);
    }

    // ---------------------------------------------------------------------
    // CRUD / completion scenarios.
    // ---------------------------------------------------------------------

    [Fact]
    public async Task HappyPath_CreateListEditCompleteDelete_WorksEndToEnd()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Groceries");

        // Create
        var createResponse = await client.PostAsJsonAsync($"/api/projects/{projectId}/tasks", new CreateTaskRequest
        {
            Title = "Buy milk",
            Description = "2% preferred",
        });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(created);
        Assert.Equal("Buy milk", created!.Title);
        Assert.Equal("2% preferred", created.Description);
        Assert.Equal(projectId, created.ProjectId);
        Assert.Equal(0, created.Order);
        Assert.False(created.IsComplete);
        Assert.Null(created.CompletedAt);

        var created2 = await CreateTaskAsync(client, projectId, "Buy eggs");
        Assert.Equal(1, created2.Order);

        // List, ordered
        var listResponse = await client.GetAsync($"/api/projects/{projectId}/tasks");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<List<TaskResponse>>();
        Assert.NotNull(list);
        Assert.Equal(new List<int> { created.Id, created2.Id }, list!.Select(t => t.Id).ToList());

        // Edit
        var updateResponse = await client.PutAsJsonAsync($"/api/tasks/{created.Id}", new UpdateTaskRequest
        {
            Title = "Buy oat milk",
            Description = "Updated",
        });
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(updated);
        Assert.Equal("Buy oat milk", updated!.Title);
        Assert.Equal("Updated", updated.Description);

        // Complete (covers AE1: not-yet-complete task, checked off, gets a completion timestamp,
        // remains in the system).
        var completeResponse = await client.PutAsync($"/api/tasks/{created.Id}/complete", null);
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        var completed = await completeResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(completed);
        Assert.True(completed!.IsComplete);
        Assert.NotNull(completed.CompletedAt);

        var listAfterComplete = await client.GetAsync($"/api/projects/{projectId}/tasks");
        var listAfterCompleteBody = await listAfterComplete.Content.ReadFromJsonAsync<List<TaskResponse>>();
        Assert.Contains(listAfterCompleteBody!, t => t.Id == created.Id && t.IsComplete);

        // Uncomplete
        var uncompleteResponse = await client.PutAsync($"/api/tasks/{created.Id}/uncomplete", null);
        Assert.Equal(HttpStatusCode.OK, uncompleteResponse.StatusCode);
        var uncompleted = await uncompleteResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(uncompleted);
        Assert.False(uncompleted!.IsComplete);
        Assert.Null(uncompleted.CompletedAt);

        // Delete
        var deleteResponse = await client.DeleteAsync($"/api/tasks/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var listAfterDelete = await client.GetAsync($"/api/projects/{projectId}/tasks");
        var listAfterDeleteBody = await listAfterDelete.Content.ReadFromJsonAsync<List<TaskResponse>>();
        Assert.DoesNotContain(listAfterDeleteBody!, t => t.Id == created.Id);
    }

    [Fact]
    public async Task Complete_IsIdempotent_KeepsOriginalCompletedAtOnRepeat()
    {
        var client = _factory.CreateClient();
        var projectId = await CreateProjectAsync(client, "Work");
        var task = await CreateTaskAsync(client, projectId, "Ship it");

        var firstResponse = await client.PutAsync($"/api/tasks/{task.Id}/complete", null);
        firstResponse.EnsureSuccessStatusCode();
        var firstCompleted = await firstResponse.Content.ReadFromJsonAsync<TaskResponse>();
        Assert.NotNull(firstCompleted!.CompletedAt);

        // Re-completing an already-complete task is a no-op: the original timestamp is preserved
        // rather than being reset to "now".
        var secondResponse = await client.PutAsync($"/api/tasks/{task.Id}/complete", null);
        secondResponse.EnsureSuccessStatusCode();
        var secondCompleted = await secondResponse.Content.ReadFromJsonAsync<TaskResponse>();

        Assert.True(secondCompleted!.IsComplete);
        Assert.Equal(firstCompleted.CompletedAt, secondCompleted.CompletedAt);
    }

    [Fact]
    public async Task CreatingTaskWithTitleExceeding200Characters_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");

        var response = await client.PostAsJsonAsync($"/api/projects/{projectId}/tasks", new CreateTaskRequest
        {
            Title = new string('a', 201),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatingTaskWithDescriptionExceeding2000Characters_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");

        var response = await client.PostAsJsonAsync($"/api/projects/{projectId}/tasks", new CreateTaskRequest
        {
            Title = "Some task",
            Description = new string('a', 2001),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.NotNull(problem);
        Assert.Contains("Description", problem!.Errors.Keys);
    }

    [Fact]
    public async Task CreatingTaskWithEmptyTitle_Returns400ValidationError()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");

        var response = await client.PostAsJsonAsync($"/api/projects/{projectId}/tasks", new CreateTaskRequest
        {
            Title = "",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatingTaskInNonexistentProject_Returns404()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/projects/999999/tasks", new CreateTaskRequest
        {
            Title = "Some task",
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task EditingNonexistentTask_Returns404()
    {
        var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync("/api/tasks/999999", new UpdateTaskRequest
        {
            Title = "Doesn't matter",
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeletingTask_DoesNotAffectOtherTasksInProject()
    {
        var client = _factory.CreateClient();

        var projectId = await CreateProjectAsync(client, "Project");
        var taskA = await CreateTaskAsync(client, projectId, "A");
        var taskB = await CreateTaskAsync(client, projectId, "B");

        var deleteResponse = await client.DeleteAsync($"/api/tasks/{taskA.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var db = CreateDirectDbContext();
        Assert.Null(db.Tasks.SingleOrDefault(t => t.Id == taskA.Id));
        var remainingB = db.Tasks.Single(t => t.Id == taskB.Id);
        Assert.Equal(1, remainingB.Order); // untouched, not compacted to 0
    }
}
