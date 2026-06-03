$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies @(
  "System.Windows.Forms",
  "System.Drawing",
  "System.Web.Extensions"
) -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace InfiniteDeskPreview {
  public class PreviewItem {
    public string id { get; set; }
    public string hwnd { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public bool visible { get; set; }
    public int opacity { get; set; }
  }

  public class PreviewCommand {
    public string action { get; set; }
    public List<PreviewItem> previews { get; set; }
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct DwmThumbnailProperties {
    public int dwFlags;
    public Rect rcDestination;
    public Rect rcSource;
    public byte opacity;
    [MarshalAs(UnmanagedType.Bool)]
    public bool fVisible;
    [MarshalAs(UnmanagedType.Bool)]
    public bool fSourceClientAreaOnly;
  }

  public sealed class PreviewForm : Form {
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int DWM_TNP_RECTDESTINATION = 0x00000001;
    private const int DWM_TNP_OPACITY = 0x00000004;
    private const int DWM_TNP_VISIBLE = 0x00000008;
    private const int DWM_TNP_SOURCECLIENTAREAONLY = 0x00000010;

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr hwndDestination, IntPtr hwndSource, out IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref DwmThumbnailProperties properties);

    private IntPtr thumbnail = IntPtr.Zero;
    private IntPtr sourceHwnd = IntPtr.Zero;

    public PreviewForm() {
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      StartPosition = FormStartPosition.Manual;
      BackColor = Color.Black;
      TopMost = true;
      Opacity = 1.0;
      Width = 1;
      Height = 1;
    }

    protected override bool ShowWithoutActivation {
      get { return true; }
    }

    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        return cp;
      }
    }

    public void UpdatePreview(IntPtr nextSourceHwnd, Rectangle bounds, byte nextOpacity) {
      if (bounds.Width <= 1 || bounds.Height <= 1 || nextSourceHwnd == IntPtr.Zero) {
        HidePreview();
        return;
      }

      Bounds = bounds;
      if (!Visible) {
        Show();
      }

      if (thumbnail == IntPtr.Zero || sourceHwnd != nextSourceHwnd) {
        UnregisterThumbnail();
        sourceHwnd = nextSourceHwnd;
        int registerResult = DwmRegisterThumbnail(Handle, sourceHwnd, out thumbnail);
        if (registerResult != 0 || thumbnail == IntPtr.Zero) {
          HidePreview();
          return;
        }
      }

      DwmThumbnailProperties properties = new DwmThumbnailProperties();
      properties.dwFlags = DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY;
      properties.rcDestination = new Rect { left = 0, top = 0, right = bounds.Width, bottom = bounds.Height };
      properties.opacity = nextOpacity;
      properties.fVisible = true;
      properties.fSourceClientAreaOnly = false;
      DwmUpdateThumbnailProperties(thumbnail, ref properties);
    }

    public void HidePreview() {
      if (Visible) {
        Hide();
      }
    }

    protected override void Dispose(bool disposing) {
      UnregisterThumbnail();
      base.Dispose(disposing);
    }

    private void UnregisterThumbnail() {
      if (thumbnail != IntPtr.Zero) {
        DwmUnregisterThumbnail(thumbnail);
        thumbnail = IntPtr.Zero;
      }
      sourceHwnd = IntPtr.Zero;
    }
  }

  public sealed class PreviewContext : ApplicationContext {
    private readonly Control invoker = new Control();
    private readonly Dictionary<string, PreviewForm> forms = new Dictionary<string, PreviewForm>();

    public PreviewContext() {
      invoker.CreateControl();
      IntPtr ignored = invoker.Handle;
    }

    public void Post(Action action) {
      if (invoker.IsDisposed) {
        return;
      }
      invoker.BeginInvoke(action);
    }

    public void HandleCommand(PreviewCommand command) {
      string action = command.action == null ? "" : command.action.ToLowerInvariant();
      if (action == "exit") {
        ClearForms(true);
        ExitThread();
        return;
      }

      if (action == "clear" || action == "hide") {
        ClearForms(action == "clear");
        return;
      }

      if (action != "sync") {
        return;
      }

      HashSet<string> seen = new HashSet<string>();
      if (command.previews != null) {
        foreach (PreviewItem item in command.previews) {
          if (item == null || String.IsNullOrWhiteSpace(item.id)) {
            continue;
          }
          seen.Add(item.id);

          PreviewForm form;
          if (!forms.TryGetValue(item.id, out form) || form.IsDisposed) {
            form = new PreviewForm();
            forms[item.id] = form;
          }

          if (!item.visible || String.IsNullOrWhiteSpace(item.hwnd) || item.width <= 1 || item.height <= 1) {
            form.HidePreview();
            continue;
          }

          IntPtr sourceHwnd = ParseHwnd(item.hwnd);
          byte opacity = item.opacity <= 0 ? (byte)255 : (byte)Math.Min(255, item.opacity);
          form.UpdatePreview(sourceHwnd, new Rectangle(item.x, item.y, item.width, item.height), opacity);
        }
      }

      List<string> staleIds = new List<string>();
      foreach (string id in forms.Keys) {
        if (!seen.Contains(id)) {
          staleIds.Add(id);
        }
      }
      foreach (string id in staleIds) {
        forms[id].HidePreview();
      }
    }

    private void ClearForms(bool dispose) {
      foreach (PreviewForm form in forms.Values) {
        if (dispose) {
          form.Dispose();
        } else {
          form.HidePreview();
        }
      }
      if (dispose) {
        forms.Clear();
      }
    }

    private static IntPtr ParseHwnd(string value) {
      if (String.IsNullOrWhiteSpace(value)) {
        return IntPtr.Zero;
      }
      string trimmed = value.Trim();
      if (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
        return new IntPtr(Convert.ToInt64(trimmed.Substring(2), 16));
      }
      return new IntPtr(Convert.ToInt64(trimmed));
    }
  }

  public static class Host {
    public static void Run() {
      JavaScriptSerializer serializer = new JavaScriptSerializer();
      ManualResetEventSlim ready = new ManualResetEventSlim(false);
      PreviewContext context = null;

      Thread uiThread = new Thread(delegate() {
        Application.EnableVisualStyles();
        context = new PreviewContext();
        ready.Set();
        Application.Run(context);
      });
      uiThread.IsBackground = false;
      uiThread.SetApartmentState(ApartmentState.STA);
      uiThread.Start();
      ready.Wait();

      string line;
      while ((line = Console.ReadLine()) != null) {
        if (String.IsNullOrWhiteSpace(line)) {
          continue;
        }
        try {
          PreviewCommand command = serializer.Deserialize<PreviewCommand>(line);
          context.Post(delegate() { context.HandleCommand(command); });
        } catch (Exception error) {
          Console.Error.WriteLine(error.Message);
        }
      }

      context.Post(delegate() { context.HandleCommand(new PreviewCommand { action = "exit" }); });
      uiThread.Join();
    }
  }
}
"@

[InfiniteDeskPreview.Host]::Run()
