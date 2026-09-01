#Requires -Version 5.1
# WPF fallback when WebView2 is not available. Same four screens, same installer.
param(
    [string]$WorkDir,
    [string]$Version = "0.1.1"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$dest = Join-Path $env:LOCALAPPDATA "SubStudioBrowser"
$script:mode = "esr"
$script:busy = $false

function Find-Installer([string]$Root) {
    return Get-ChildItem -LiteralPath $Root -Filter "Install-SubStudioBrowser.ps1" -Recurse | Select-Object -First 1 -ExpandProperty FullName
}

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="SubStudio Browser" Width="1080" Height="700"
        WindowStartupLocation="CenterScreen" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent"
        ResizeMode="NoResize" FontFamily="Segoe UI">
  <Border CornerRadius="10" Background="#F3EBE3" Padding="22,18,22,22">
    <DockPanel>
      <Border DockPanel.Dock="Top" HorizontalAlignment="Center" CornerRadius="20" Background="#F7F3EC" Padding="4" Margin="0,0,0,12">
        <StackPanel Orientation="Horizontal">
          <Border Background="#111" CornerRadius="16" Padding="10,5"><TextBlock Text="Windows" Foreground="White" FontSize="13"/></Border>
          <TextBlock Text="macOS" Foreground="#9A9590" Margin="14,5,8,5"/>
          <TextBlock Text="Linux" Foreground="#9A9590" Margin="8,5,10,5"/>
        </StackPanel>
      </Border>
      <Border CornerRadius="22" Background="#FFFCF9">
        <Grid>
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="0.36*"/>
            <ColumnDefinition Width="0.64*"/>
          </Grid.ColumnDefinitions>
          <Border CornerRadius="22,0,0,22">
            <Border.Background>
              <LinearGradientBrush StartPoint="0,0" EndPoint="0,1">
                <GradientStop Color="#FF9E6A" Offset="0"/>
                <GradientStop Color="#7B5EE8" Offset="0.72"/>
                <GradientStop Color="#4A2D8C" Offset="1"/>
              </LinearGradientBrush>
            </Border.Background>
            <DockPanel Margin="28">
              <StackPanel DockPanel.Dock="Bottom">
                <TextBlock Text="SubStudio Browser" FontFamily="Georgia" FontSize="28" Foreground="White"/>
                <TextBlock x:Name="BrandVer" Margin="0,8,0,0" Foreground="#E8E0FF" FontSize="13"/>
              </StackPanel>
            </DockPanel>
          </Border>
          <Grid Grid.Column="1" Margin="40,48,36,24">
            <Grid.RowDefinitions>
              <RowDefinition Height="*"/>
              <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>
            <StackPanel x:Name="Welcome">
              <TextBlock FontFamily="Georgia" FontSize="36" TextWrapping="Wrap">Install a browser you'll actually open.</TextBlock>
              <TextBlock Margin="0,12,0,0" Foreground="#5C5A56" TextWrapping="Wrap"
                         Text="Свой Firefox, вертикальные вкладки, Grok в сайдбаре. Системный браузер не трогаем."/>
              <TextBlock Margin="0,22,0,0" FontWeight="SemiBold" Text="1  Свой runtime"/>
              <TextBlock Foreground="#808080" Text="Копия Firefox в %LOCALAPPDATA% — не hijack."/>
              <TextBlock Margin="0,12,0,0" FontWeight="SemiBold" Text="2  Grok sidecar"/>
              <TextBlock Foreground="#808080" Text="Официальный xAI, без скрейпа grok.com."/>
              <TextBlock Margin="0,12,0,0" FontWeight="SemiBold" Text="3  Прокси как было"/>
              <TextBlock Foreground="#808080" Text="FoxyProxy и контейнеры. VPN — отдельным клиентом."/>
            </StackPanel>
            <StackPanel x:Name="Runtime" Visibility="Collapsed">
              <TextBlock FontFamily="Georgia" FontSize="36" Text="How should Grok live?"/>
              <TextBlock Margin="0,12,0,16" Foreground="#5C5A56" TextWrapping="Wrap"
                         Text="Unsigned sidecar на обычном Firefox Release не держится. Честный выбор."/>
              <Button x:Name="CardEsr" Margin="0,0,0,10" Padding="14" HorizontalContentAlignment="Left">
                <StackPanel>
                  <TextBlock FontWeight="SemiBold" Text="Fetch Firefox ESR"/>
                  <TextBlock Foreground="#808080" TextWrapping="Wrap" Text="Официальный ESR в папку SubStudio. Sidecar ставится. Рекомендуем."/>
                </StackPanel>
              </Button>
              <Button x:Name="CardCopy" Padding="14" HorizontalContentAlignment="Left">
                <StackPanel>
                  <TextBlock FontWeight="SemiBold" Text="Copy the Firefox I already have"/>
                  <TextBlock Foreground="#808080" TextWrapping="Wrap" Text="Быстрее. На Release сайдбар Grok может отвалиться."/>
                </StackPanel>
              </Button>
            </StackPanel>
            <StackPanel x:Name="Installing" Visibility="Collapsed">
              <TextBlock FontFamily="Georgia" FontSize="34" TextWrapping="Wrap" Text="Putting the studio on this machine."/>
              <TextBlock x:Name="StatusText" Margin="0,16,0,0" Foreground="#6F6C67" FontSize="16" Text="Fetching Grok sidecar..."/>
              <ProgressBar x:Name="Bar" Height="6" Margin="0,24,0,0" Minimum="0" Maximum="100" Value="8"/>
              <TextBlock Margin="0,14,0,0" Foreground="#808080" TextWrapping="Wrap"
                         Text="Это не системный браузер. Можно закрыть окно — докачаем в фоне."/>
            </StackPanel>
            <StackPanel x:Name="Done" Visibility="Collapsed">
              <TextBlock FontFamily="Georgia" FontSize="40" Text="It's yours."/>
              <TextBlock x:Name="DoneCopy" Margin="0,14,0,0" Foreground="#5C5A56" TextWrapping="Wrap"/>
              <TextBlock Margin="0,22,0,0" Text="Ctrl+K — Командная строка, как в Dia."/>
              <TextBlock Margin="0,8,0,0" Text="@tab — Grok видит вкладки, если разрешишь."/>
            </StackPanel>
            <DockPanel Grid.Row="1" Margin="0,16,0,0">
              <TextBlock x:Name="PathText" DockPanel.Dock="Left" VerticalAlignment="Center" Foreground="#8A8680" FontFamily="Consolas"/>
              <Button x:Name="BackBtn" DockPanel.Dock="Left" Content="Back" Visibility="Collapsed" Margin="0,0,12,0" Background="Transparent" BorderThickness="0"/>
              <Button x:Name="FolderBtn" DockPanel.Dock="Left" Content="Open folder" Visibility="Collapsed" Background="Transparent" BorderThickness="0"/>
              <Button x:Name="Primary" DockPanel.Dock="Right" Content="Continue" Padding="22,10" FontWeight="SemiBold"
                      Background="#111" Foreground="White" BorderThickness="0"/>
            </DockPanel>
          </Grid>
        </Grid>
      </Border>
    </DockPanel>
  </Border>
</Window>
"@

$window = [Windows.Markup.XamlReader]::Parse($xaml)
$welcome = $window.FindName("Welcome")
$runtime = $window.FindName("Runtime")
$installing = $window.FindName("Installing")
$done = $window.FindName("Done")
$primary = $window.FindName("Primary")
$back = $window.FindName("BackBtn")
$folder = $window.FindName("FolderBtn")
$pathText = $window.FindName("PathText")
$brandVer = $window.FindName("BrandVer")
$doneCopy = $window.FindName("DoneCopy")
$statusText = $window.FindName("StatusText")
$bar = $window.FindName("Bar")
$cardEsr = $window.FindName("CardEsr")
$cardCopy = $window.FindName("CardCopy")
$screen = "welcome"

$brandVer.Text = "$Version · a browser you want to open"
$pathText.Text = $dest
$doneCopy.Text = "SubStudio Browser $Version готов. Обновления прилетят с GitHub Releases, не из магазина Mozilla."

function Show-Screen([string]$Name) {
    $script:screen = $Name
    $welcome.Visibility = [Windows.Visibility]::Collapsed
    $runtime.Visibility = [Windows.Visibility]::Collapsed
    $installing.Visibility = [Windows.Visibility]::Collapsed
    $done.Visibility = [Windows.Visibility]::Collapsed
    $back.Visibility = [Windows.Visibility]::Collapsed
    $folder.Visibility = [Windows.Visibility]::Collapsed
    $pathText.Visibility = [Windows.Visibility]::Collapsed
    switch ($Name) {
        "welcome" {
            $welcome.Visibility = [Windows.Visibility]::Visible
            $pathText.Visibility = [Windows.Visibility]::Visible
            $primary.Content = "Continue"
        }
        "runtime" {
            $runtime.Visibility = [Windows.Visibility]::Visible
            $back.Visibility = [Windows.Visibility]::Visible
            $primary.Content = "Install SubStudio"
        }
        "installing" {
            $installing.Visibility = [Windows.Visibility]::Visible
            $primary.Visibility = [Windows.Visibility]::Collapsed
        }
        "done" {
            $done.Visibility = [Windows.Visibility]::Visible
            $folder.Visibility = [Windows.Visibility]::Visible
            $primary.Visibility = [Windows.Visibility]::Visible
            $primary.Content = "Launch SubStudio"
        }
        default { throw "unknown screen $Name" }
    }
}

$cardEsr.Add_Click({ $script:mode = "esr" })
$cardCopy.Add_Click({ $script:mode = "copy" })
$back.Add_Click({ Show-Screen "welcome" })
$folder.Add_Click({ Start-Process explorer.exe $dest })

$primary.Add_Click({
    if ($script:screen -eq "welcome") { Show-Screen "runtime"; return }
    if ($script:screen -eq "done") {
        $launch = Get-ChildItem -LiteralPath $WorkDir -Filter "Launch-SubStudioBrowser.ps1" -Recurse | Select-Object -First 1
        if ($launch) {
            Start-Process powershell.exe -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $launch.FullName)
        }
        $window.Close()
        return
    }
    if ($script:busy) { return }
    $script:busy = $true
    Show-Screen "installing"
    $setup = Find-Installer $WorkDir
    $log = Join-Path $env:TEMP "ssb-setup-progress-$Version.jsonl"
    if (Test-Path $log) { Remove-Item $log -Force }
    $arg = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $setup, "-GuiProgress", "-ProgressLog", $log)
    if ($script:mode -ne "copy") { $arg += "-FetchEsr" }
    Start-Process -FilePath powershell.exe -ArgumentList $arg -WindowStyle Hidden
    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(250)
    $timer.Add_Tick({
        if (-not (Test-Path $log)) { return }
        $lines = Get-Content $log -ErrorAction SilentlyContinue
        if (-not $lines) { return }
        $last = $lines[-1] | ConvertFrom-Json
        if ($last.percent) { $bar.Value = $last.percent }
        if ($last.status) { $statusText.Text = $last.status }
        if ($last.phase -eq "done") {
            $timer.Stop()
            Show-Screen "done"
        }
        if ($last.phase -eq "error") {
            $timer.Stop()
            $statusText.Text = $last.detail
        }
    })
    $timer.Start()
})

Show-Screen "welcome"
[void]$window.ShowDialog()
