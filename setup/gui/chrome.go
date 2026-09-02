//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUser32 = windows.NewLazySystemDLL("user32.dll")
	modDwm    = windows.NewLazySystemDLL("dwmapi.dll")

	procGetWindowLongPtrW = modUser32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW = modUser32.NewProc("SetWindowLongPtrW")
	procSetWindowPos      = modUser32.NewProc("SetWindowPos")
	procReleaseCapture    = modUser32.NewProc("ReleaseCapture")
	procSendMessageW      = modUser32.NewProc("SendMessageW")
	procShowWindow        = modUser32.NewProc("ShowWindow")
	procDestroyWindow     = modUser32.NewProc("DestroyWindow")
	procDwmSetAttr        = modDwm.NewProc("DwmSetWindowAttribute")
)

const (
	gwlStyle                    = -16
	gwlExStyle                  = -20
	wsCaption                   = 0x00C00000
	wsThickFrame                = 0x00040000
	wsMinimizeBox               = 0x00020000
	wsMaximizeBox               = 0x00010000
	wsSysMenu                   = 0x00080000
	wsPopup                     = 0x80000000
	wsVisible                   = 0x10000000
	wsExAppWindow               = 0x00040000
	swpNoMove                   = 0x0002
	swpNoZOrder                 = 0x0004
	swpFrameChanged             = 0x0020
	wmNCLButtonDown             = 0x00A1
	htCaption                   = 2
	dwmwaWindowCornerPreference = 33
	dwmwcpRound                 = 2
)

func nIndex(v int32) uintptr {
	return uintptr(v)
}

func makeFrameless(hwnd windows.HWND) {
	styleIdx := int32(gwlStyle)
	exIdx := int32(gwlExStyle)
	style, _, _ := procGetWindowLongPtrW.Call(uintptr(hwnd), nIndex(styleIdx))
	style &^= wsCaption | wsThickFrame | wsMinimizeBox | wsMaximizeBox | wsSysMenu
	style |= wsPopup | wsVisible
	_, _, _ = procSetWindowLongPtrW.Call(uintptr(hwnd), nIndex(styleIdx), style)

	ex, _, _ := procGetWindowLongPtrW.Call(uintptr(hwnd), nIndex(exIdx))
	ex |= wsExAppWindow
	_, _, _ = procSetWindowLongPtrW.Call(uintptr(hwnd), nIndex(exIdx), ex)

	pref := int32(dwmwcpRound)
	_, _, _ = procDwmSetAttr.Call(
		uintptr(hwnd),
		uintptr(dwmwaWindowCornerPreference),
		uintptr(unsafe.Pointer(&pref)),
		unsafe.Sizeof(pref),
	)

	_, _, _ = procSetWindowPos.Call(
		uintptr(hwnd),
		0,
		0, 0, 0, 0,
		swpNoMove|swpNoZOrder|swpFrameChanged,
	)
}

func destroyWindow(hwnd windows.HWND) {
	if hwnd == 0 {
		return
	}
	_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
}

func dragWindow(hwnd windows.HWND) {
	_, _, _ = procReleaseCapture.Call()
	_, _, _ = procSendMessageW.Call(uintptr(hwnd), wmNCLButtonDown, htCaption, 0)
}

func minimizeWindow(hwnd windows.HWND) {
	const swMinimize = 6
	_, _, _ = procShowWindow.Call(uintptr(hwnd), swMinimize)
}
