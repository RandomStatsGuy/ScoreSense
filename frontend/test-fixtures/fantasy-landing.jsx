// Actual AppRouter, navigation and Fantasy workspace with isolated fixture APIs.
import React from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import AppRouter from "../src/AppRouter";
import {AuthContext} from "../src/AuthContext";
import {AppearanceProvider} from "../src/AppearanceProvider";
import "./fantasy-home-data.js";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/appearance.css";
const auth={ready:true,authenticated:true,user:{name:"Caleb K",sub:"fixture",email_verified:true},hubAuthRequired:false,openSignIn:()=>{},logout:()=>{}};
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthContext.Provider value={auth}><AppearanceProvider><AppRouter/></AppearanceProvider></AuthContext.Provider></BrowserRouter>);
