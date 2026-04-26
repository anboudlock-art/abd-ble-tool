package com.anboud.prod.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.authDataStore by preferencesDataStore("auth")

private val KEY_TOKEN = stringPreferencesKey("access_token")
private val KEY_API_BASE = stringPreferencesKey("api_base_url")
private val KEY_USER_NAME = stringPreferencesKey("user_name")
private val KEY_USER_ROLE = stringPreferencesKey("user_role")

class AuthStore(private val context: Context) {

    val token: Flow<String?> =
        context.authDataStore.data.map { it[KEY_TOKEN] }

    val apiBaseUrl: Flow<String?> =
        context.authDataStore.data.map { it[KEY_API_BASE] }

    val userName: Flow<String?> =
        context.authDataStore.data.map { it[KEY_USER_NAME] }

    val userRole: Flow<String?> =
        context.authDataStore.data.map { it[KEY_USER_ROLE] }

    suspend fun saveLogin(token: String, name: String, role: String) {
        context.authDataStore.edit {
            it[KEY_TOKEN] = token
            it[KEY_USER_NAME] = name
            it[KEY_USER_ROLE] = role
        }
    }

    suspend fun saveApiBase(base: String) {
        context.authDataStore.edit { it[KEY_API_BASE] = base.trimEnd('/') }
    }

    suspend fun clear() {
        context.authDataStore.edit { prefs ->
            prefs.remove(KEY_TOKEN)
            prefs.remove(KEY_USER_NAME)
            prefs.remove(KEY_USER_ROLE)
        }
    }
}
