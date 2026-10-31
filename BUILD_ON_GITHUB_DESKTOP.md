# Build NOVA on GitHub (no local Rust/C++ setup)

This project ZIP includes a GitHub Actions workflow that attempts a Windows x64 build. It does **not** guarantee the app is functional; the workflow must pass and the installed app must be tested.

## 1. Extract the project

Extract this ZIP to a folder such as `C:\NOVA`. Make sure `package.json`, `package-lock.json`, `src-tauri`, `src`, `extension`, and `.github` are directly inside `C:\NOVA` (not inside an extra nested folder).

## 2. Install GitHub Desktop

Download GitHub Desktop from https://desktop.github.com/ and sign in to GitHub.

## 3. Create a private repository from the folder

1. Open GitHub Desktop.
2. Choose **File → Add Local Repository**. Browse to `C:\NOVA`.
3. If GitHub Desktop says this is not a Git repository, choose **create a repository**. Use `NOVA-Download-Manager` as the name.
4. Keep the repository local path as `C:\NOVA`.
5. Click **Create Repository**.
6. Review the changed files. Commit them with a message such as `Prepare NOVA Windows build`.
7. Click **Publish repository**.
8. Turn on **Keep this code private** and publish.

Do not upload `.env` files, passwords, API keys, browser cookies, or personal download databases. The included `.gitignore` excludes common local data and build output.

## 4. Run the cloud Windows build

1. Open the repository on github.com.
2. Select the **Actions** tab.
3. Select **Build NOVA for Windows** in the left sidebar.
4. Click **Run workflow**, choose the `main` branch, and click the green **Run workflow** button.
5. Open the new run and wait for it to finish.
6. If it succeeds, scroll to **Artifacts** and download `NOVA-Windows-x64-release`.
7. Extract the downloaded artifact ZIP. It should contain the installer if the Tauri bundling step succeeded, plus extension packages.

## 5. If the workflow fails

Open the failed step, copy the first meaningful error and share it for diagnosis. Do not repeatedly rerun without fixing the cause. A successful compile is not the same as verified download functionality.

## Important limitations

- This workflow builds the source; it does not prove all protocols, resume, browser handoff, or floating video detection work correctly.
- Windows may show an unknown-publisher warning because the installer is not code-signed. Only install builds you trust.
- Browser native messaging still needs correct extension ID registration on each PC. Do not enable automatic interception until end-to-end handoff has been tested.
- Keep the repository private if you do not intend to publish the source code.
