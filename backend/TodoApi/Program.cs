using Microsoft.EntityFrameworkCore;
using TodoApi.Data;
using TodoApi.Endpoints;
using TodoApi.Middleware;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Data Source=todo.db;Foreign Keys=True";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

// Correlation-ID middleware runs first so the correlation ID is established (and attached to
// the logging scope) before anything else in the pipeline — including the exception handler —
// has a chance to log. Exception handling wraps everything after it, so any exception thrown by
// later middleware or endpoints is still caught and logged with that same correlation ID.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

app.MapGet("/", () => "Hello World!");

app.MapProjectEndpoints();

app.Run();

public partial class Program
{
}
