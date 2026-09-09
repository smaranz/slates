; Custom NSIS steps for the Slates Windows installer.
; Included by electron-builder — see electron-builder.config.cjs.
;
; The install itself is per-user (%LOCALAPPDATA%\Programs\Slates) so it does
; not ask for administrator. That matches the app: one student, one machine.

!macro customUnInstall
  ; Leave %USERPROFILE%\.slates alone. API keys, the counselor library index,
  ; timer history, and lesson renders live there, and wiping them from the
  ; uninstaller would feel like the uninstall ate their work.
!macroend
