; Custom NSIS macros for FunnelHive Tally Connector
; Enforces a minimum Windows version (10 build 17763 / 1809) before installing.

!macro preInit
  ; Read Windows build number from the registry. Available on Win 10 1607+.
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmp $0 17763 winOk winTooOld winOk
  winTooOld:
    MessageBox MB_ICONSTOP|MB_OK "FunnelHive Tally Connector requires Windows 10 version 1809 (build 17763) or later, or Windows 11.$\r$\n$\r$\nYour system reports build $0. Please update Windows and try again."
    Quit
  winOk:
!macroend

!macro customInstall
  ; Nothing custom yet, reserved for future steps (firewall rules, etc.).
!macroend
