# Why Git says "everything is up to date"

Git only pushes **commits**. If you never run `git add` and `git commit`, your saved files are only on your PC—Git will still say "up to date" because the last commit was already pushed.

## Quick sync (add + commit + push)

In PowerShell, from the project folder:

```powershell
.\push.ps1 "describe what you changed"
```

Example: `.\push.ps1 "Fix day trade table"`

If there are no changes, it will say "Nothing to commit". If there are changes, it will add, commit, and push them.

## Manual steps

1. **Save your files** in the editor (Ctrl+S).
2. **Add and commit:**
   ```powershell
   cd "c:\Users\jeff\Documents\eve trade"
   git add .
   git commit -m "Your message"
   ```
3. **Push:**
   ```powershell
   git push origin main
   ```

## What is not pushed (on purpose)

- **`.env`** – secrets (API keys, passwords). Never commit this.
- **`node_modules/`** – dependencies (Vercel runs `npm install`).
- **`dist/`** – build output (Vercel runs `npm run build`).

So "up to date" means: *the last commit is on GitHub*. To get new edits there, you must **add → commit → push** (or run `.\push.ps1 "message"`).
