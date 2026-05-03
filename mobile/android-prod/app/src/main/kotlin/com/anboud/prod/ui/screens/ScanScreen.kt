package com.anboud.prod.ui.screens

import android.annotation.SuppressLint
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.anboud.prod.scan.ScanStep
import com.anboud.prod.ui.AppViewModel
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    vm: AppViewModel,
    batchId: Long,
    batchNo: String,
    onBack: () -> Unit,
) {
    var lockId by remember { mutableStateOf<String?>(null) }
    var step by remember { mutableStateOf<ScanStep>(ScanStep.Searching) }
    var running by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(lockId) {
        val id = lockId ?: return@LaunchedEffect
        if (running) return@LaunchedEffect
        running = true
        try {
            vm.runScan(id, batchId) { newStep -> step = newStep }
        } finally {
            running = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("采集 · $batchNo") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {

            if (lockId == null) {
                Text(
                    "请将摄像头对准锁体上的 QR 码",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
                QrScannerView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(3f / 4f),
                    onScanned = { value ->
                        // accept 8-digit lockIds
                        if (value.matches(Regex("\\d{8}"))) lockId = value
                    },
                )
            } else {
                Card(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "锁号：${lockId}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(step.label, style = MaterialTheme.typography.bodyMedium)
                        if (running) {
                            Spacer(Modifier.height(8.dp))
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }
                        when (val s = step) {
                            is ScanStep.Done -> {
                                Spacer(Modifier.height(12.dp))
                                Text("✅ 采集成功", color = MaterialTheme.colorScheme.primary)
                                Text(
                                    "MAC: ${s.resp.device.bleMac}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(
                                    "状态: ${s.resp.device.status}（${if (s.resp.firstScan) "新设备" else "复扫"}）",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            is ScanStep.Error -> {
                                Spacer(Modifier.height(12.dp))
                                Text(
                                    "❌ ${s.message}",
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            else -> {}
                        }
                        Spacer(Modifier.height(12.dp))
                        Box(modifier = Modifier.fillMaxWidth()) {
                            TextButton(
                                onClick = {
                                    lockId = null
                                    step = ScanStep.Searching
                                },
                                modifier = Modifier.align(Alignment.CenterEnd),
                            ) {
                                Text("继续采集下一台")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
@SuppressLint("UnsafeOptInUsageError")
private fun QrScannerView(modifier: Modifier, onScanned: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scanner = remember { BarcodeScanning.getClient() }
    val scope = rememberCoroutineScope()

    Box(
        modifier = modifier.background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val executor = ContextCompat.getMainExecutor(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val provider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { proxy ->
                        processFrame(proxy, scanner, onScanned)
                    }
                    runCatching { provider.unbindAll() }
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                    scope.launch { /* keep scope alive */ }
                }, executor)
                previewView
            },
        )
    }
}

@SuppressLint("UnsafeOptInUsageError")
private fun processFrame(
    proxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    onScanned: (String) -> Unit,
) {
    val mediaImage = proxy.image
    if (mediaImage == null) {
        proxy.close()
        return
    }
    val input = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)
    scanner.process(input)
        .addOnSuccessListener { barcodes ->
            for (b in barcodes) {
                if (b.format == Barcode.FORMAT_QR_CODE) {
                    val raw = b.rawValue ?: continue
                    onScanned(raw)
                    return@addOnSuccessListener
                }
            }
        }
        .addOnCompleteListener { proxy.close() }
}
