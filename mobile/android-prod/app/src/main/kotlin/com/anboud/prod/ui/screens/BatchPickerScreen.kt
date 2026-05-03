package com.anboud.prod.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.anboud.prod.ui.AppViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BatchPickerScreen(
    vm: AppViewModel,
    onPickBatch: (Long, String) -> Unit,
    onLogout: () -> Unit,
) {
    val batches by vm.batches.collectAsState()
    val busy by vm.busy.collectAsState()
    val userName by vm.userName.collectAsState()

    LaunchedEffect(Unit) { vm.loadBatches() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("选择生产批次") },
                actions = {
                    Text(
                        text = userName ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    TextButton(onClick = onLogout) { Text("退出") }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (busy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            if (batches.isEmpty() && !busy) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text("暂无生产批次")
                    Text(
                        "请在 Web 平台创建后下拉刷新",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { /* loadBatches will rerun on recompose */ }) {
                        Text("刷新")
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(batches, key = { it.id }) { b ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { onPickBatch(b.id.toLong(), b.batchNo) },
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(b.batchNo, style = MaterialTheme.typography.titleMedium)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "${b.modelCode ?: "—"} · ${b.modelName ?: ""}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                                Spacer(Modifier.height(8.dp))
                                Row {
                                    Text(
                                        "已采集 ${b.producedCount} / ${b.quantity}",
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
