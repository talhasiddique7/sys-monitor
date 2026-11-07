# Contributing to System Monitor

Thanks for helping improve System Monitor. You can contribute a new feature, fix a bug, improve documentation, or report an issue.

## Make a change

1. Fork the repository on GitHub, then clone your fork:

   ```bash
   git clone https://github.com/talhasiddique7/sys-monitor.git
   cd sys-monitor
   ```

2. Create a branch from the latest `main`. Use `feat/` for a feature or `fix/` for a bug fix:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/add-disk-monitoring
   ```

   For a bug fix, use a branch such as:

   ```bash
   git checkout -b fix/network-speed-calculation
   ```

3. Make your changes. Keep each pull request focused on one feature or bug. When a change affects GNOME Shell compatibility, update both the modern and legacy implementation where applicable.

4. Run the project checks:

   ```bash
   make check
   ```

5. Commit and push your work:

   ```bash
   git add .
   git commit -m "feat: add disk monitoring"
   git push -u origin feat/add-disk-monitoring
   ```

   Use a clear commit prefix such as `feat:`, `fix:`, or `docs:`.

6. Open a pull request to the `main` branch of `talhasiddique7/sys-monitor`.

## Pull request checklist

Before submitting your pull request, make sure:

- The title clearly describes the feature or bug fix.
- The description explains what changed and why.
- Related issues are linked, for example `Fixes #123`.
- `make check` passes.
- Screenshots are included for visible UI changes.
- The pull request contains only related changes.

Maintainers may request changes. Push additional commits to the same branch and the pull request will update automatically.
