//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func main() {
	root := os.Getenv("LOCALAPPDATA")
	app := filepath.Join(root, "SubStudioBrowser")
	exe := filepath.Join(app, "runtime", "firefox.exe")
	profile := filepath.Join(app, "profile")
	if _, err := os.Stat(exe); err != nil {
		windows.MessageBox(0, utf16("SubStudio Browser"), utf16("Firefox copy is missing. Run Setup.exe again."), windows.MB_OK|windows.MB_ICONERROR)
		os.Exit(1)
	}
	cmd := exec.Command(exe, "-profile", profile, "-no-remote")
	cmd.Dir = filepath.Join(app, "runtime")
	if err := cmd.Start(); err != nil {
		windows.MessageBox(0, utf16("SubStudio Browser"), utf16(err.Error()), windows.MB_OK|windows.MB_ICONERROR)
		os.Exit(1)
	}
}

func utf16(value string) *uint16 {
	p, _ := windows.UTF16PtrFromString(value)
	return p
}
