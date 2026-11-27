package ru.lastcall.country

import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.GetBillingConfigParams
import com.android.billingclient.api.PendingPurchasesParams
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Google Play account country, for the sign-up policy only: Play Billing's BillingConfig (no
 * purchase is made, no runtime permission). Null when unavailable.
 */
class LastCallCountryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LastCallCountry")

    AsyncFunction("playCountry") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val settled = AtomicBoolean(false)
      val client = BillingClient.newBuilder(context)
        .setListener { _, _ -> }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()
      fun finish(country: String?) {
        if (!settled.compareAndSet(false, true)) return
        try { client.endConnection() } catch (_: Throwable) { }
        promise.resolve(country?.takeIf { it.isNotBlank() }?.uppercase())
      }
      try {
        client.startConnection(object : BillingClientStateListener {
          override fun onBillingSetupFinished(result: BillingResult) {
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return finish(null)
            client.getBillingConfigAsync(GetBillingConfigParams.newBuilder().build()) { response, config ->
              finish(if (response.responseCode == BillingClient.BillingResponseCode.OK) config?.countryCode else null)
            }
          }
          override fun onBillingServiceDisconnected() = finish(null)
        })
      } catch (_: Throwable) {
        finish(null)
      }
    }
  }
}
