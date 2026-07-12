using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using TodoApi.Models;

namespace TodoApi.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<TaskItem> Tasks => Set<TaskItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Project>(entity =>
        {
            entity.Property(p => p.Name).IsRequired().HasMaxLength(200);
        });

        // SQLite has no datetime column type, so EF stores DateTimes as bare text and reads them
        // back with Kind=Unspecified. System.Text.Json serializes Unspecified values without a
        // timezone marker ("...T02:09:22.062052", no trailing "Z"), which fails clients that
        // require ISO 8601 with a zone (the frontend's generated Zod schemas do). Every datetime
        // this app writes is UTC (DateTime.UtcNow), so re-label values as UTC when materializing.
        var utcDateTime = new ValueConverter<DateTime, DateTime>(
            v => v.ToUniversalTime(),
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        modelBuilder.Entity<TaskItem>(entity =>
        {
            entity.Property(t => t.Title).IsRequired().HasMaxLength(200);
            entity.Property(t => t.Description).HasMaxLength(2000);

            entity.Property(t => t.CreatedAt).HasConversion(utcDateTime);
            entity.Property(t => t.CompletedAt).HasConversion(utcDateTime);

            entity.HasOne(t => t.Project)
                .WithMany(p => p.Tasks)
                .HasForeignKey(t => t.ProjectId)
                .IsRequired()
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
