package com.anboud.prod.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.anboud.prod.BuildConfig
import com.anboud.prod.ble.BleClient
import com.anboud.prod.data.AbdApi
import com.anboud.prod.data.ApiException
import com.anboud.prod.data.AuthStore
import com.anboud.prod.data.ProductionBatch
import com.anboud.prod.scan.ScanFlowEngine
import com.anboud.prod.scan.ScanStep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AppViewModel(
    val authStore: AuthStore,
    val api: AbdApi,
    appContext: Context,
) : ViewModel() {

    val ble = BleClient(appContext)
    val scanEngine = ScanFlowEngine(ble, api)

    val token: StateFlow<String?> = authStore.token
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val userName: StateFlow<String?> = authStore.userName
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val apiBaseUrl: StateFlow<String> = authStore.apiBaseUrl
        .stateIn(viewModelScope, SharingStarted.Eagerly, BuildConfig.DEFAULT_API_BASE_URL)
        .also { /* react below */ }

    private val _batches = MutableStateFlow<List<ProductionBatch>>(emptyList())
    val batches = _batches.asStateFlow()

    private val _loginError = MutableStateFlow<String?>(null)
    val loginError = _loginError.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()

    init {
        // Push token + base url into the API client whenever they change.
        viewModelScope.launch {
            authStore.token.collectLatest { api.tokenValue = it }
        }
        viewModelScope.launch {
            authStore.apiBaseUrl.collectLatest { url ->
                if (!url.isNullOrBlank()) api.baseUrlValue = url
            }
        }
    }

    suspend fun login(phone: String, password: String): Boolean {
        _busy.value = true
        _loginError.value = null
        return try {
            val resp = api.login(phone, password)
            authStore.saveLogin(resp.accessToken, resp.user.name, resp.user.role)
            true
        } catch (e: ApiException) {
            _loginError.value = e.message ?: "登录失败"
            false
        } catch (t: Throwable) {
            _loginError.value = "网络错误：${t.message ?: t::class.simpleName}"
            false
        } finally {
            _busy.value = false
        }
    }

    fun logout() {
        viewModelScope.launch { authStore.clear() }
    }

    suspend fun setApiBase(url: String) {
        authStore.saveApiBase(url)
    }

    suspend fun loadBatches() {
        _busy.value = true
        try {
            _batches.value = api.listBatches(pageSize = 50).items
        } catch (_: Throwable) {
            // surfaced via UI as empty list; could add a separate error stream
            _batches.value = emptyList()
        } finally {
            _busy.value = false
        }
    }

    suspend fun runScan(
        lockId: String,
        batchId: Long,
        onStep: suspend (ScanStep) -> Unit,
    ): ScanStep = scanEngine.runOnce(lockId, batchId, onStep)
}

class AppViewModelFactory(
    private val authStore: AuthStore,
    private val api: AbdApi,
    private val appContext: Context,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return AppViewModel(authStore, api, appContext) as T
    }
}
