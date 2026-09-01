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

func startInstall(root, mode string, onLine func(string)) error {
	script, err := findInstaller(root)
	if err != nil {
		return err
	}
	logPath := filepath.Join(os.TempDir(), "ssb-setup-progress-"+productVersion+".jsonl")
	_ = os.Remove(logPath)

	args := []string{
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", script,
		"-GuiProgress",
		"-ProgressLog", logPath,
	}
	if mode != "copy" {
		args = append(args, "-FetchEsr")
	}

	cmd := exec.Command("powershell.exe", args...)
	cmd.Dir = filepath.Dir(script)
	cmd.SysProcAttr = &windows.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewProcessGroup | createNoWindow,
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	go watchInstall(cmd, logPath, onLine)
	return nil
}

func watchInstall(cmd *exec.Cmd, logPath string, onLine func(string)) {
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

	for {
		select {
		case err := <-done:
			offset = drainProgress(logPath, offset, wrap)
			if sawTerminal {
				return
			}
			if err != nil {
				wrap(mustJSON(map[string]interface{}{
					"phase":  "error",
					"detail": "Install failed: " + err.Error(),
					"status": "Failed",
				}))
				return
			}
			if _, statErr := os.Stat(filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser", "VERSION")); statErr != nil {
				wrap(mustJSON(map[string]interface{}{
					"phase":  "error",
					"detail": "Install did not finish. Retry with Fetch Firefox ESR.",
					"status": "Failed",
				}))
			}
			return
		case <-timeout.C:
			wrap(mustJSON(map[string]interface{}{
				"phase":  "error",
				"detail": "Install timed out.",
				"status": "Failed",
			}))
			return
		case <-ticker.C:
			offset = drainProgress(logPath, offset, wrap)
		}
	}
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
		exe := filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser", "runtime", "firefox.exe")
		profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser", "profile")
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
