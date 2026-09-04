Attribute VB_Name = "OpenRouterExcel"
' ============================================================
' OpenRouter Excel Integration — VBA User-Defined Functions
' ============================================================
' Usage in worksheet:
'   =OPENROUTER_CHAT("Your prompt here", "model-name", temperature, max_tokens)
'   =OPENROUTER_CHAT_SYSTEM("System prompt", "User prompt", "model-name", temperature, max_tokens)
'   =OPENROUTER_LIST_MODELS()  ' returns vertical array of model IDs
'
' Setup:
' 1. In VBA Editor (Alt+F11): File → Import File → select this .bas
' 2. Tools → References → check "Microsoft WinHTTP Services, version 5.1"
' 3. Set your API key in the CONST below or via named range "OpenRouter_API_Key"
' 4. Save workbook as .xlsm (macro-enabled)
'
' Models: https://openrouter.ai/models
' Popular: "openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5",
'          "meta-llama/llama-3.1-70b-instruct", "nousresearch/hermes-3-llama-3.1-405b"
' ============================================================

Option Explicit

' ----- CONFIG -----
' Option A: Hardcode (not recommended for sharing)
Private Const DEFAULT_API_KEY As String = "YOUR_OPENROUTER_KEY_HERE"

' Option B: Read from a named range "OpenRouter_API_Key" (create via Formulas → Define Name)
'           Put your key in a cell (e.g., Sheet1!Z1), name that cell "OpenRouter_API_Key"
' Option C: Set via VBA before calling:  OpenRouterExcel.SetAPIKey "sk-or-..."

Private Const OPENROUTER_BASE_URL As String = "https://openrouter.ai/api/v1"
Private Const DEFAULT_MODEL As String = "openai/gpt-4o-mini"
Private Const REQUEST_TIMEOUT_MS As Long = 120000  ' 2 minutes

' App identity for OpenRouter leaderboard (optional but recommended)
Private Const APP_NAME As String = "Excel-OpenRouter"
Private Const APP_URL As String = "https://github.com/NousResearch/hermes-agent"

' ----- STATE -----
Private sCachedAPIKey As String
Private bKeyInitialized As Boolean

' ============================================================
' PUBLIC UDFs — use these in worksheet cells
' ============================================================

' Main chat completion: =OPENROUTER_CHAT("prompt", "model", temp, max_tokens)
Public Function OPENROUTER_CHAT( _
    ByVal sPrompt As String, _
    Optional ByVal sModel As String = "", _
    Optional ByVal dTemperature As Double = 0.3, _
    Optional ByVal lMaxTokens As Long = 2000 _
) As Variant
    Debug.Print ">>> OPENROUTER_CHAT called"
    Dim sSystem As String
    sSystem = "You are a helpful assistant embedded in Excel. Be concise. Return only the answer — no markdown unless asked."
    OPENROUTER_CHAT = InternalChatCompletion(sSystem, sPrompt, sModel, dTemperature, lMaxTokens)
End Function

' Chat with custom system prompt: =OPENROUTER_CHAT_SYSTEM("system", "user", "model", temp, max_tokens)
Public Function OPENROUTER_CHAT_SYSTEM( _
    ByVal sSystemPrompt As String, _
    ByVal sUserPrompt As String, _
    Optional ByVal sModel As String = "", _
    Optional ByVal dTemperature As Double = 0.3, _
    Optional ByVal lMaxTokens As Long = 2000 _
) As Variant
    Debug.Print ">>> OPENROUTER_CHAT_SYSTEM called"
    OPENROUTER_CHAT_SYSTEM = InternalChatCompletion(sSystemPrompt, sUserPrompt, sModel, dTemperature, lMaxTokens)
End Function

' List available models (array formula): select vertical range, enter =OPENROUTER_LIST_MODELS(), Ctrl+Shift+Enter
Public Function OPENROUTER_LIST_MODELS() As Variant
    Dim sResp As String, vResult As Variant
    sResp = HttpGet(OPENROUTER_BASE_URL & "/models")
    If Len(sResp) = 0 Then
        OPENROUTER_LIST_MODELS = CVErr(xlErrNA)
        Exit Function
    End If
    vResult = ParseModelList(sResp)
    If IsArray(vResult) Then
        OPENROUTER_LIST_MODELS = Application.Transpose(vResult)
    Else
        OPENROUTER_LIST_MODELS = vResult
    End If
End Function

' Helper to set API key at runtime (call from another macro or Immediate window)
Public Sub SetAPIKey(ByVal sKey As String)
    sCachedAPIKey = sKey
    bKeyInitialized = True
End Sub

' ============================================================
' INTERNAL — Chat Completion
' ============================================================
Private Function InternalChatCompletion( _
    ByVal sSystem As String, _
    ByVal sUser As String, _
    ByVal sModel As String, _
    ByVal dTemp As Double, _
    ByVal lMaxTok As Long _
) As Variant

    Dim sKey As String, sPayload As String, sResp As String
    Dim sModelFinal As String
    Dim oReq As Object
    
    Debug.Print ">>> InternalChatCompletion start"
    sKey = GetAPIKey()
    Debug.Print ">>> GetAPIKey done, len=" & Len(sKey)
    If Len(sKey) = 0 Then
        InternalChatCompletion = CVErr(xlErrValue)
        Exit Function
    End If
    
    If Len(sModel) = 0 Then sModelFinal = DEFAULT_MODEL Else sModelFinal = sModel
    Debug.Print ">>> Model: " & sModelFinal
    
    sPayload = BuildChatPayload(sSystem, sUser, sModelFinal, dTemp, lMaxTok)
    Debug.Print ">>> BuildChatPayload done, len=" & Len(sPayload)
    
    Set oReq = CreateObject("WinHttp.WinHttpRequest.5.1")
    Debug.Print ">>> CreateObject done"
    oReq.SetTimeouts 5000, 5000, REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS
    Debug.Print ">>> SetTimeouts done"
    oReq.Open "POST", OPENROUTER_BASE_URL & "/chat/completions", False
    Debug.Print ">>> Open done"
    oReq.SetRequestHeader "Content-Type", "application/json"
    oReq.SetRequestHeader "Authorization", "Bearer " & sKey
    oReq.SetRequestHeader "HTTP-Referer", APP_URL
    oReq.SetRequestHeader "X-Title", APP_NAME
    Debug.Print ">>> Headers set"
    oReq.Send sPayload
    Debug.Print ">>> Send done, status=" & oReq.Status
    
    If oReq.Status = 200 Then
        sResp = oReq.ResponseText
        Debug.Print ">>> Response len=" & Len(sResp)
    Else
        sResp = "{\"error\":{\"status\":" & oReq.Status & ",\"body\":" & JsonEscape(oReq.ResponseText) & "}}"
        Debug.Print ">>> HTTP error: " & oReq.Status
    End If
    
    InternalChatCompletion = ExtractMessageContent(sResp)
    Debug.Print ">>> ExtractMessageContent done"
End Function

' ============================================================
' HTTP HELPERS
' ============================================================
Private Function HttpPost(ByVal sUrl As String, ByVal sApiKey As String, ByVal sJsonBody As String) As String
    Dim oReq As Object
    Set oReq = CreateObject("WinHttp.WinHttpRequest.5.1")
    
    On Error GoTo ErrHandler
    oReq.SetTimeouts 5000, 5000, REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS
    oReq.Open "POST", sUrl, False
    oReq.SetRequestHeader "Content-Type", "application/json"
    oReq.SetRequestHeader "Authorization", "Bearer " & sApiKey
    oReq.SetRequestHeader "HTTP-Referer", APP_URL
    oReq.SetRequestHeader "X-Title", APP_NAME
    oReq.Send sJsonBody
    
    If oReq.Status = 200 Then
        HttpPost = oReq.ResponseText
    Else
        ' Return error details for debugging
        HttpPost = "{\"error\":{\"status\":" & oReq.Status & ",\"body\":" & JsonEscape(oReq.ResponseText) & "}}"
    End If
    Exit Function
    
ErrHandler:
    HttpPost = ""
End Function

Private Function HttpGet(ByVal sUrl As String) As String
    Dim oReq As Object
    Set oReq = CreateObject("WinHttp.WinHttpRequest.5.1")
    
    On Error GoTo ErrHandler
    oReq.SetTimeouts 5000, 5000, 30000, 30000
    oReq.Open "GET", sUrl, False
    oReq.SetRequestHeader "Authorization", "Bearer " & GetAPIKey()
    oReq.Send
    
    If oReq.Status = 200 Then
        HttpGet = oReq.ResponseText
    Else
        HttpGet = ""
    End If
    Exit Function
    
ErrHandler:
    HttpGet = ""
End Function

' ============================================================
' JSON BUILDING & PARSING (lightweight, no external deps)
' ============================================================
Private Function BuildChatPayload(ByVal sSystem, ByVal sUser, ByVal sModel, ByVal dTemp, ByVal lMaxTok) As String
    ' {"model":"...","messages":[{"role":"system","content":"..."},{"role":"user","content":"..."}],"temperature":0.3,"max_tokens":2000}
    Dim sSysEsc As String, sUserEsc As String
    sSysEsc = JsonEscape(sSystem)
    sUserEsc = JsonEscape(sUser)
    
    BuildChatPayload = "{""model"":""" & sModel & """," & _
                       ""messages"":[{""role"":""system"",""content"":""" & sSysEsc & """}," & _
                                  "{""role"":""user"",""content"":""" & sUserEsc & """}]," & _
                       ""temperature"":" & FormatNumber(dTemp, 2, vbFalse, vbFalse, vbFalse) & "," & _
                       ""max_tokens"":" & lMaxTok & "}"
End Function

Private Function ExtractMessageContent(ByVal sJson As String) As Variant
    ' Find "content":"..." in the first choice.message
    Dim lStart As Long, lEnd As Long, sContent As String
    Dim sSearch As String
    sSearch = """content"":"
    
    lStart = InStr(1, sJson, sSearch, vbTextCompare)
    If lStart = 0 Then
        ExtractMessageContent = CVErr(xlErrValue)
        Exit Function
    End If
    lStart = lStart + Len(sSearch)
    ' Skip whitespace
    Do While lStart <= Len(sJson) And Mid(sJson, lStart, 1) Like "[ \t\r\n]"
        lStart = lStart + 1
    Loop
    If lStart > Len(sJson) Or Mid(sJson, lStart, 1) <> """" Then
        ExtractMessageContent = CVErr(xlErrValue)
        Exit Function
    End If
    lStart = lStart + 1  ' skip opening quote
    lEnd = lStart
    Do While lEnd <= Len(sJson)
        Dim ch As String
        ch = Mid(sJson, lEnd, 1)
        If ch = """" Then
            ' Check if escaped
            If lEnd > 1 And Mid(sJson, lEnd - 1, 1) = "\" Then
                lEnd = lEnd + 1
            Else
                Exit Do
            End If
        ElseIf ch = "\" And lEnd < Len(sJson) Then
            lEnd = lEnd + 2  ' skip escaped char
        Else
            lEnd = lEnd + 1
        End If
    Loop
    If lEnd > Len(sJson) Then
        ExtractMessageContent = CVErr(xlErrValue)
        Exit Function
    End If
    sContent = Mid(sJson, lStart, lEnd - lStart)
    ' Unescape basic JSON escapes
    sContent = Replace(sContent, "\n", vbLf)
    sContent = Replace(sContent, "\r", vbCr)
    sContent = Replace(sContent, "\t", vbTab)
    sContent = Replace(sContent, "\\", "\")
    sContent = Replace(sContent, "\""", """")
    sContent = Replace(sContent, "\/", "/")
    ExtractMessageContent = sContent
End Function

Private Function ParseModelList(ByVal sJson As String) As Variant
    ' Returns 1D array of model IDs from /models response
    Dim lPos As Long, lCount As Long, vModels() As String
    Dim sSearch As String, sId As String
    sSearch = """id"":"""
    lPos = 1
    lCount = 0
    ' First pass: count
    Do
        lPos = InStr(lPos, sJson, sSearch, vbTextCompare)
        If lPos = 0 Then Exit Do
        lCount = lCount + 1
        lPos = lPos + Len(sSearch)
    Loop
    If lCount = 0 Then
        ParseModelList = CVErr(xlErrNA)
        Exit Function
    End If
    ReDim vModels(1 To lCount)
    ' Second pass: extract
    lPos = 1
    lCount = 0
    Do
        lPos = InStr(lPos, sJson, sSearch, vbTextCompare)
        If lPos = 0 Then Exit Do
        lPos = lPos + Len(sSearch)
        Dim lEnd As Long
        lEnd = InStr(lPos, sJson, """")
        If lEnd = 0 Then Exit Do
        sId = Mid(sJson, lPos, lEnd - lPos)
        lCount = lCount + 1
        vModels(lCount) = sId
        lPos = lEnd + 1
    Loop
    If lCount < UBound(vModels) Then ReDim Preserve vModels(1 To lCount)
    ParseModelList = vModels
End Function

Private Function JsonEscape(ByVal s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, vbCrLf, "\n")
    s = Replace(s, vbLf, "\n")
    s = Replace(s, vbCr, "\n")
    s = Replace(s, vbTab, "\t")
    s = Replace(s, "/", "\/")  ' optional but safe
    JsonEscape = s
End Function

Private Function GetAPIKey() As String
    If bKeyInitialized And Len(sCachedAPIKey) > 0 Then
        GetAPIKey = sCachedAPIKey
        Exit Function
    End If
    ' Try named range
    On Error Resume Next
    Dim nm As Name
    For Each nm In ThisWorkbook.Names
        If StrComp(nm.Name, "OpenRouter_API_Key", vbTextCompare) = 0 Then
            sCachedAPIKey = CStr(nm.RefersToRange.Value)
            bKeyInitialized = True
            GetAPIKey = sCachedAPIKey
            Exit Function
        End If
    Next nm
    On Error GoTo 0
    ' Fallback to constant
    If Len(DEFAULT_API_KEY) > 0 And DEFAULT_API_KEY <> "YOUR_OPENROUTER_KEY_HERE" Then
        sCachedAPIKey = DEFAULT_API_KEY
        bKeyInitialized = True
        GetAPIKey = sCachedAPIKey
    Else
        GetAPIKey = ""
    End If
End Function
