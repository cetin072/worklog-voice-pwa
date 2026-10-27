package expo.modules.worklogplayupdate

import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WorklogPlayUpdateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WorklogPlayUpdate")
    AsyncFunction("isUpdateAvailable") { promise: Promise ->
      val context = appContext.reactContext
      // QA/development packages must never advertise production updates.
      if (context == null || context.packageName != "com.cetin072.worklog") {
        promise.resolve(false)
      } else {
        try {
          AppUpdateManagerFactory.create(context).appUpdateInfo
            .addOnSuccessListener { info ->
              promise.resolve(info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
            }
            .addOnFailureListener { promise.resolve(false) }
            .addOnCanceledListener { promise.resolve(false) }
        } catch (_: Exception) {
          promise.resolve(false)
        }
      }
    }
  }
}
