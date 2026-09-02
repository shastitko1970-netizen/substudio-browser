//go:build windows

package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	windowWidth  = 1080
	windowHeight = 700
)

var (
	productVersion = "0.1.3"
	ui             webview2.WebView
	hwnd           windows.HWND
	workDir        string
	installing     bool
)

func main() {
	root, err := prepareWorkdir()
	if err != nil {
		windows.MessageBox(0, utf16("SubStudio Browser"), utf16("Could not unpack setup files:\n"+err.Error()), windows.MB_OK|windows.MB_ICONERROR)
		os.Exit(1)
	}
	workDir = root

	ui = webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(os.TempDir(), "SubStudioBrowser-webview"),
		WindowOptions: webview2.WindowOptions{
			Title:  "SubStudio Browser",
			Width:  windowWidth,
			Height: windowHeight,
			Center: true,
		},
	})
	if ui == nil {
		if err := runFallback(root); err != nil {
			windows.MessageBox(0, utf16("SubStudio Browser"), utf16("WebView2 is missing and the fallback UI failed:\n"+err.Error()), windows.MB_OK|windows.MB_ICONERROR)
			os.Exit(1)
		}
		return
	}
	defer ui.Destroy()

	hwnd = windows.HWND(uintptr(ui.Window()))
	makeFrameless(hwnd)
	ui.SetSize(windowWidth, windowHeight, webview2.HintFixed)

	mustBind("ssbGetState", nativeState)
	mustBind("ssbStartInstall", nativeStartInstall)
	mustBind("ssbOpenFolder", nativeOpenFolder)
	mustBind("ssbLaunch", nativeLaunch)
	mustBind("ssbClose", nativeClose)
	mustBind("ssbMinimize", nativeMinimize)
	mustBind("ssbDrag", nativeDrag)

	index := filepath.Join(root, "ui", "index.html")
	ui.Navigate(toFileURL(index))
	ui.Run()
}

func mustBind(name string, fn interface{}) {
	if err := ui.Bind(name, fn); err != nil {
		log.Fatal(err)
	}
}

func nativeState() map[string]string {
	dest := filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser")
	scheme := "light"
	if windowsAppsDark() {
		scheme = "dark"
	}
	return map[string]string{
		"version":      productVersion,
		"destPath":     dest,
		"windowsTheme": scheme,
	}
}

func nativeStartInstall(mode string) error {
	stopInstall()
	installing = true
	return startInstall(workDir, mode, func(raw string) {
		script := "if(window.ssbOnProgress)window.ssbOnProgress(" + raw + ")"
		if ui != nil {
			ui.Dispatch(func() { ui.Eval(script) })
		}
	})
}

func nativeOpenFolder() {
	dest := filepath.Join(os.Getenv("LOCALAPPDATA"), "SubStudioBrowser")
	_ = openPath(dest)
}

func nativeLaunch() error {
	return launchBrowser(workDir)
}

func nativeClose(background bool) {
	_ = background
	stopInstall()
	if ui != nil {
		ui.Terminate()
	}
	destroyWindow(hwnd)
	hwnd = 0
}

func nativeMinimize() {
	minimizeWindow(hwnd)
}

func nativeDrag() {
	dragWindow(hwnd)
}

func utf16(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("SubStudio")
	}
	return p
}

func toFileURL(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return "file:///" + filepath.ToSlash(abs)
}

func mustJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"phase":"error","detail":"json"}`
	}
	return string(b)
}
