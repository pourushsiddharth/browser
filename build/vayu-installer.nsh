; NSIS hooks for electron-builder
; Included via build.nsis.include in package.json

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var VayuDlg
Var OptDesktopHandle
Var OptStartMenuHandle
Var OptDefaultHandle
Var OptShieldHandle

Var OptDesktopState
Var OptStartMenuState
Var OptDefaultState
Var OptShieldState
!endif

!macro preInit
  ; Ensure shell variables are resolved per-user for current session
  SetShellVarContext current
!macroend

!ifndef BUILD_UNINSTALLER
!macro customWelcomePage
  Page custom VayuWelcomePageCreate VayuWelcomePageLeave
!macroend

!macro customPageAfterChangeDir
  Page custom VayuOptionsPageCreate VayuOptionsPageLeave
!macroend

Function VayuWelcomePageCreate
  !insertmacro MUI_HEADER_TEXT "Welcome to Vayu" "A fast, private browser built for modern browsing"

  nsDialogs::Create 1018
  Pop $VayuDlg
  ${If} $VayuDlg == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 6u 100% 14u "This wizard will install Vayu on your computer."
  Pop $0

  ${NSD_CreateLabel} 0 24u 100% 14u "What you get with Vayu:"
  Pop $0

  ${NSD_CreateLabel} 8u 42u 100% 12u "- Secure defaults with privacy-first browsing"
  Pop $0
  ${NSD_CreateLabel} 8u 56u 100% 12u "- Fast startup and lightweight runtime"
  Pop $0
  ${NSD_CreateLabel} 8u 70u 100% 12u "- Built-in ad and tracker blocking"
  Pop $0
  ${NSD_CreateLabel} 8u 84u 100% 12u "- Reliable Chromium-based compatibility"
  Pop $0

  ${NSD_CreateLabel} 0 110u 100% 12u "Click Next to continue."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function VayuWelcomePageLeave
FunctionEnd

Function VayuOptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "Installation Options" "Choose your Vayu setup preferences"

  StrCpy $OptDesktopState ${BST_CHECKED}
  StrCpy $OptStartMenuState ${BST_CHECKED}
  StrCpy $OptDefaultState ${BST_UNCHECKED}
  StrCpy $OptShieldState ${BST_CHECKED}

  nsDialogs::Create 1018
  Pop $VayuDlg
  ${If} $VayuDlg == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 6u 100% 14u "Select the setup options you want to apply:"
  Pop $0

  ${NSD_CreateCheckbox} 0 28u 100% 12u "Create desktop shortcut"
  Pop $OptDesktopHandle
  ${NSD_SetState} $OptDesktopHandle $OptDesktopState

  ${NSD_CreateCheckbox} 0 45u 100% 12u "Create Start menu shortcut"
  Pop $OptStartMenuHandle
  ${NSD_SetState} $OptStartMenuHandle $OptStartMenuState

  ${NSD_CreateCheckbox} 0 62u 100% 12u "Set Vayu as default browser"
  Pop $OptDefaultHandle
  ${NSD_SetState} $OptDefaultHandle $OptDefaultState

  ${NSD_CreateCheckbox} 0 79u 100% 12u "Enable smart privacy shield"
  Pop $OptShieldHandle
  ${NSD_SetState} $OptShieldHandle $OptShieldState

  ${NSD_CreateLabel} 0 103u 100% 24u "These preferences are saved and can be changed later from Vayu settings."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function VayuOptionsPageLeave
  ${NSD_GetState} $OptDesktopHandle $OptDesktopState
  ${NSD_GetState} $OptStartMenuHandle $OptStartMenuState
  ${NSD_GetState} $OptDefaultHandle $OptDefaultState
  ${NSD_GetState} $OptShieldHandle $OptShieldState
FunctionEnd
!endif

!macro customInstall
  DetailPrint "Applying Vayu installer defaults..."

  ${If} $OptStartMenuState != ${BST_CHECKED}
    Delete "$newStartMenuLink"
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}

  ${If} $OptDesktopState != ${BST_CHECKED}
    Delete "$newDesktopLink"
  ${EndIf}

  ${If} $OptDefaultState == ${BST_CHECKED}
    ; Open Windows default apps settings so user can complete default browser selection.
    ; Windows blocks silent default browser takeover, so this is the supported flow.
    ExecShell "open" "ms-settings:defaultapps"
  ${EndIf}

  ; Persist install metadata and user-selected options
  WriteRegStr HKCU "Software\\Vayu" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Vayu" "Version" "${VERSION}"
  WriteRegDWORD HKCU "Software\\Vayu" "Installed" 1

  WriteRegDWORD HKCU "Software\\Vayu" "CreateDesktopShortcut" $OptDesktopState
  WriteRegDWORD HKCU "Software\\Vayu" "CreateStartMenuShortcut" $OptStartMenuState
  WriteRegDWORD HKCU "Software\\Vayu" "SetAsDefaultBrowser" $OptDefaultState
  WriteRegDWORD HKCU "Software\\Vayu" "EnablePrivacyShield" $OptShieldState
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\\Vayu"
!macroend
