package ru.lastcall.country

import android.content.Context
import android.telephony.TelephonyManager
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
 * Countries the phone itself knows, for the sign-up policy only. None of these needs a runtime
 * permission: the Google Play account country comes from Play Billing's BillingConfig (no purchase
 * is made), the network and SIM countries from TelephonyManager. Each is null when unavailable.
 */
class LastCallCountryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LastCallCountry")

    AsyncFunction("telephony") {
      val telephony = appContext.reactContext?.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      mapOf(
        "network" to telephony?.networkCountryIso?.takeIf { it.isNotBlank() }?.uppercase(),
        "sim" to telephony?.simCountryIso?.takeIf { it.isNotBlank() }?.uppercase(),
      )
    }

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
