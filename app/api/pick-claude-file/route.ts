import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Browsers strip the real filesystem path from <input type="file"> for
// privacy reasons — there's no way around that from client-side JS. But
// since this app's server and the person using it are always the same
// local machine, the server can pop the OS's own native file dialog
// directly and hand the path back, which is what "browse for the file"
// actually means here.
const PICK_FILE_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select the Claude Code executable'
$dialog.Filter = 'Claude Code (claude.cmd;claude.exe;claude)|claude.cmd;claude.exe;claude|All files (*.*)|*.*'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
`;

export async function POST() {
  if (process.platform !== "win32") {
    return Response.json(
      { path: null, error: "The native file picker is only available on Windows — type the path in manually instead." },
      { status: 400 }
    );
  }

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", PICK_FILE_SCRIPT], {
      timeout: 120_000, // the dialog waits on the person, not the network
    });
    const path = stdout.trim();
    return Response.json({ path: path || null });
  } catch (err) {
    return Response.json(
      { path: null, error: err instanceof Error ? err.message : "Couldn't open the file picker." },
      { status: 500 }
    );
  }
}
