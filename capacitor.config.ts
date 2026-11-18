import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.justmoney',
  appName: 'JustMoney',
  webDir: 'dist',
  android: { backgroundColor: '#000000' },
  plugins: {
    // Keep the app clear of the status and navigation bars (Android 15+ draws apps edge-to-edge).
    SystemBars: { insetsHandling: 'native' },
    // White Jm silhouette in the status bar, tinted violet when the notification is expanded.
    LocalNotifications: { smallIcon: 'ic_stat_notify', iconColor: '#8b5cf6' },
  },
}

export default config
