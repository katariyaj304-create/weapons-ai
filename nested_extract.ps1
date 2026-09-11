$zips = Get-ChildItem -Path 'c:\Users\JITENDRA KATARIYA\Weapons.ai\frontend\public\models' -Recurse -Include '*.zip'
foreach ($z in $zips) {
    Expand-Archive -Path $z.FullName -DestinationPath $z.DirectoryName -Force
}
