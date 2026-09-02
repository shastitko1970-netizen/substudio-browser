//go:build windows

package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

//go:embed all:ui
var uiFS embed.FS

//go:embed overlay.zip
var overlayZip []byte

const createNewProcessGroup = 0x00000200
const createNoWindow = 0x08000000

func prepareWorkdir() (string, error) {
	root := filepath.Join(os.TempDir(), "SubStudioBrowser-setup-"+productVersion)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	if err := extractZip(overlayZip, root); err != nil {
		return "", err
	}
	if err := writeEmbeddedTree(uiFS, "ui", filepath.Join(root, "ui")); err != nil {
		return "", err
	}
	return root, nil
}

func extractZip(data []byte, dest string) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, file := range reader.File {
		name := filepath.FromSlash(file.Name)
		target := filepath.Join(dest, name)
		if !strings.HasPrefix(target, filepath.Clean(dest)+string(os.PathSeparator)) && target != filepath.Clean(dest) {
			return errors.New("illegal path in overlay zip")
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := file.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			in.Close()
			return err
		}
		_, copyErr := io.Copy(out, in)
		in.Close()
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func writeEmbeddedTree(src embed.FS, prefix, dest string) error {
	return fs.WalkDir(src, prefix, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(prefix, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := src.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func findInstaller(root string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.EqualFold(d.Name(), "Install-SubStudioBrowser.ps1") {
			found = path
			return fs.SkipAll
		}
		return nil
	})
	if found == "" {
		if err != nil {
			return "", err
		}
		return "", errors.New("Install-SubStudioBrowser.ps1 missing from payload")
	}
	return found, nil
}

func findRepoRoot(script string) string {
	cur := filepath.Dir(script)
	for i := 0; i < 8; i++ {
		if fileExists(filepath.Join(cur, "mozilla.cfg")) &&
			fileExists(filepath.Join(cur, "distribution", "policies.json")) &&
			fileExists(filepath.Join(cur, "extension", "manifest.json")) {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return filepath.Dir(script)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func appRoot() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser")
}

func setupLogPath() string {
	return filepath.Join(appRoot(), "setup.log")
}

func appendSetupLog(path, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = file.WriteString(text)
	if !strings.HasSuffix(text, "\n") {
		_, _ = file.WriteString("\n")
	}
	_ = file.Close()
}

func startInstall(root, mode string, onLine func(string)) error {
	script, err := findInstaller(root)
	if err != nil {
		return err
	}
	dest := appRoot()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	logPath := filepath.Join(dest, "setup-progress.jsonl")
	setupLog := setupLogPath()
	consolePath := filepath.Join(dest, "setup-console.log")
	_ = os.Remove(logPath)
	_ = os.Remove(consolePath)

	args := []string{
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-OutputFormat", "Text",
		"-File", script,
		"-GuiProgress",
		"-ProgressLog", logPath,
		"-SetupLog", setupLog,
	}
	if mode != "copy" {
		args = append(args, "-FetchEsr")
	}

	appendSetupLog(setupLog, "=== SubStudio Browser "+productVersion+" "+time.Now().Format(time.RFC3339)+" ===\n")
	appendSetupLog(setupLog, "cmd: powershell.exe "+strings.Join(args, " ")+"\n")
	appendSetupLog(setupLog, "script: "+script+"\n")
	appendSetupLog(setupLog, "overlay: "+root+"\n")

	console, err := os.Create(consolePath)
	if err != nil {
		return err
	}

	cmd := exec.Command("powershell.exe", args...)
	cmd.Dir = findRepoRoot(script)
	cmd.Stdout = console
	cmd.Stderr = console
	cmd.SysProcAttr = &windows.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewProcessGroup | createNoWindow,
	}
	if err := cmd.Start(); err != nil {
		_ = console.Close()
		appendSetupLog(setupLog, "start failed: "+err.Error()+"\n")
		return err
	}

	go watchInstall(cmd, logPath, setupLog, consolePath, console, onLine)
	return nil
}

func watchInstall(cmd *exec.Cmd, logPath, setupLog, consolePath string, console *os.File, onLine func(string)) {
	var offset int64
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(45 * time.Minute)
	defer timeout.Stop()

	sawTerminal := false
	wrap := func(raw string) {
		if strings.Contains(raw, `"phase":"done"`) || strings.Contains(raw, `"phase":"error"`) {
			sawTerminal = true
		}
		if onLine != nil {
			onLine(raw)
		}
	}

	readConsole := func() string {
		if console != nil {
			_ = console.Close()
			console = nil
		}
		body, err := os.ReadFile(consolePath)
		if err != nil {
			return ""
		}
		appendSetupLog(setupLog, "--- powershell stdout+stderr ---\n"+string(body))
		return string(body)
	}

	for {
		select {
		case err := <-done:
			offset = drainProgress(logPath, offset, wrap)
			output := readConsole()
			if sawTerminal {
				return
			}
			if err != nil {
				wrap(mustJSON(map[string]interface{}{
					"phase":  "error",
					"detail": formatInstallFailure(err, output, setupLog),
					"status": "Failed",
				}))
				return
			}
			if _, statErr := os.Stat(filepath.Join(appRoot(), "VERSION")); statErr != nil {
				wrap(mustJSON(map[string]interface{}{
					"phase":  "error",
					"detail": formatInstallFailure(errors.New("install did not finish"), output, setupLog),
					"status": "Failed",
				}))
			}
			return
		case <-timeout.C:
			wrap(mustJSON(map[string]interface{}{
				"phase":  "error",
				"detail": "Install timed out. Open %LOCALAPPDATA%\\SubStudioBrowser\\setup.log",
				"status": "Failed",
			}))
			return
		case <-ticker.C:
			offset = drainProgress(logPath, offset, wrap)
		}
	}
}

func formatInstallFailure(waitErr error, console, setupLog string) string {
	if useful := usefulPowerShell(console); useful != "" {
		return useful
	}
	if body, err := os.ReadFile(setupLog); err == nil {
		if useful := usefulPowerShell(string(body)); useful != "" {
			return useful
		}
	}
	if waitErr != nil && !isBareExitStatus(waitErr) {
		return waitErr.Error()
	}
	return "PowerShell failed with no message. Open %LOCALAPPDATA%\\SubStudioBrowser\\setup.log"
}

func isBareExitStatus(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "exit status") || strings.Contains(msg, "exit code")
}

func usefulPowerShell(raw string) string {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		if strings.HasPrefix(trim, "##SSB##") || strings.HasPrefix(trim, "{") && strings.Contains(trim, `"phase"`) {
			continue
		}
		if strings.HasPrefix(trim, "===") || strings.HasPrefix(trim, "cmd:") || strings.HasPrefix(trim, "script:") {
			continue
		}
		kept = append(kept, trim)
	}
	if len(kept) == 0 {
		return ""
	}
	if len(kept) > 24 {
		kept = kept[len(kept)-24:]
	}
	text := strings.Join(kept, "\n")
	if len(text) > 1600 {
		text = text[len(text)-1600:]
	}
	return text
}

func drainProgress(path string, offset int64, onLine func(string)) int64 {
	file, err := os.Open(path)
	if err != nil {
		return offset
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return offset
	}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if !json.Valid([]byte(line)) {
			continue
		}
		if onLine != nil {
			onLine(line)
		}
	}
	pos, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return offset
	}
	return pos
}

func openPath(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	return exec.Command("explorer.exe", path).Start()
}

func launchBrowser(root string) error {
	script := filepath.Join(filepath.Dir(mustFind(root, "Launch-SubStudioBrowser.ps1")), "Launch-SubStudioBrowser.ps1")
	if _, err := os.Stat(script); err != nil {
		exe := filepath.Join(appRoot(), "runtime", "firefox.exe")
		profile := filepath.Join(appRoot(), "profile")
		cmd := exec.Command(exe, "-profile", profile, "-no-remote")
		cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true}
		return cmd.Start()
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script)
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd.Start()
}

func mustFind(root, name string) string {
	var found string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.EqualFold(d.Name(), name) {
			found = path
			return fs.SkipAll
		}
		return nil
	})
	return found
}

func runFallback(root string) error {
	script := filepath.Join(root, "ui", "Fallback-UI.ps1")
	if _, err := os.Stat(script); err != nil {
		installer, findErr := findInstaller(root)
		if findErr != nil {
			return findErr
		}
		cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, "-FetchEsr")
		cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: false}
		return cmd.Run()
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", script, "-WorkDir", root, "-Version", productVersion)
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd.Run()
}
