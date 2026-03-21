# Core Project Rules for Agents

- **Always Push Live**: Every time you modify HTML, CSS, Javascript, or any other code files in this project to fulfill a user request, you MUST immediately stage, commit, and `git push` those changes to the remote repository. The user relies on the GitHub-connected deployment (e.g. Netlify/Vercel) to view changes live, so local-only file writes are insufficient. Ensure you run `git add . && git commit -m "..." && git push` before telling the user the task is complete.
