param([string]$SdkDir = "$PSScriptRoot\..\discord-social-sdk")
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$header = Get-ChildItem $SdkDir -Recurse -Filter discordpp.h | Select-Object -First 1
$lib = Get-ChildItem $SdkDir -Recurse -Include *.lib | Where-Object { $_.Name -match "discord" } | Select-Object -First 1
$dll = Get-ChildItem $SdkDir -Recurse -Include *.dll | Where-Object { $_.Name -match "discord" } | Select-Object -First 1
if (!$header -or !$lib -or !$dll) { throw "Discord Social SDK Windows files not found under $SdkDir" }
$out = Join-Path $root "native\bin"
New-Item -ItemType Directory -Force $out | Out-Null
$src = Join-Path $root "native\social_bridge.cpp"
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
if (!$cl) { throw "cl.exe not found. Run this from a Visual Studio Developer PowerShell (Desktop development with C++)." }
& cl.exe /nologo /std:c++17 /EHsc /O2 /I"$($header.DirectoryName)" "$src" /Fe:"$out\social_bridge.exe" /link /LIBPATH:"$($lib.DirectoryName)" "$($lib.Name)"
if ($LASTEXITCODE -ne 0) { throw "C++ build failed." }
Copy-Item $dll.FullName $out -Force
Write-Host "Built: $out\social_bridge.exe"
