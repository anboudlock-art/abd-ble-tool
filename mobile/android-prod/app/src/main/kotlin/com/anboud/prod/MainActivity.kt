package com.anboud.prod

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.anboud.prod.data.AbdApi
import com.anboud.prod.data.AuthStore
import com.anboud.prod.ui.AppViewModel
import com.anboud.prod.ui.AppViewModelFactory
import com.anboud.prod.ui.screens.BatchPickerScreen
import com.anboud.prod.ui.screens.LoginScreen
import com.anboud.prod.ui.screens.ScanScreen

class MainActivity : ComponentActivity() {

    private val perms = mutableListOf(Manifest.permission.CAMERA).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Manifest.permission.BLUETOOTH_SCAN)
            add(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }.toTypedArray()

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permLauncher.launch(missing.toTypedArray())

        val authStore = AuthStore(applicationContext)
        val api = AbdApi(initialBaseUrl = BuildConfig.DEFAULT_API_BASE_URL)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val nav = rememberNavController()
                    val vm: AppViewModel = viewModel(
                        factory = AppViewModelFactory(authStore, api, applicationContext),
                    )
                    val token by vm.token.collectAsState()

                    LaunchedEffect(token) {
                        val current = nav.currentDestination?.route
                        if (token == null && current != "login") {
                            nav.navigate("login") {
                                popUpTo(nav.graph.startDestinationId) { inclusive = true }
                            }
                        } else if (token != null && current == "login") {
                            nav.navigate("batches") {
                                popUpTo("login") { inclusive = true }
                            }
                        }
                    }

                    Scaffold { padding ->
                        NavHost(
                            navController = nav,
                            startDestination = if (token != null) "batches" else "login",
                            modifier = Modifier.padding(padding),
                        ) {
                            composable("login") {
                                LoginScreen(vm = vm, onLoggedIn = {
                                    nav.navigate("batches") {
                                        popUpTo("login") { inclusive = true }
                                    }
                                })
                            }
                            composable("batches") {
                                BatchPickerScreen(
                                    vm = vm,
                                    onPickBatch = { id, no -> nav.navigate("scan/$id/$no") },
                                    onLogout = { vm.logout() },
                                )
                            }
                            composable("scan/{batchId}/{batchNo}") { entry ->
                                val batchId = entry.arguments?.getString("batchId")?.toLongOrNull() ?: 0L
                                val batchNo = entry.arguments?.getString("batchNo") ?: ""
                                ScanScreen(
                                    vm = vm,
                                    batchId = batchId,
                                    batchNo = batchNo,
                                    onBack = { nav.popBackStack() },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
