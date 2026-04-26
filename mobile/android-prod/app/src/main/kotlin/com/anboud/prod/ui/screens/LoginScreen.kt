package com.anboud.prod.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.anboud.prod.ui.AppViewModel
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(vm: AppViewModel, onLoggedIn: () -> Unit) {
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showApiConfig by rememberSaveable { mutableStateOf(false) }
    var apiUrlInput by rememberSaveable { mutableStateOf("") }
    val baseUrl by vm.apiBaseUrl.collectAsState()
    val busy by vm.busy.collectAsState()
    val error by vm.loginError.collectAsState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(baseUrl) {
        if (apiUrlInput.isBlank()) apiUrlInput = baseUrl
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Anboud 生产", style = MaterialTheme.typography.headlineSmall)
        Text("生产线扫码采集", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it.filter(Char::isDigit).take(11) },
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(0.85f),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(0.85f),
        )

        Spacer(Modifier.height(8.dp))
        Text(
            "服务器：$baseUrl",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        if (showApiConfig) {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = apiUrlInput,
                onValueChange = { apiUrlInput = it },
                label = { Text("API 服务器地址") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(0.85f),
            )
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = {
                scope.launch {
                    vm.setApiBase(apiUrlInput.trim())
                    showApiConfig = false
                }
            }) { Text("保存服务器地址") }
        } else {
            TextButton(onClick = { showApiConfig = true }) { Text("修改服务器地址") }
        }

        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                error ?: "",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                scope.launch {
                    if (vm.login(phone, password)) onLoggedIn()
                }
            },
            enabled = !busy && phone.length == 11 && password.length >= 6,
            modifier = Modifier.fillMaxWidth(0.85f),
        ) {
            if (busy) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
            } else {
                Text("登录")
            }
        }
    }
}
