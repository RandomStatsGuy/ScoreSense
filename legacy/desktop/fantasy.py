# -*- coding: utf-8 -*-

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Form implementation generated from reading ui file 'fantasy.ui'
#
# Created by: PyQt5 UI code generator 5.9.2
#
# WARNING! All changes made in this file will be lost!

from PyQt5 import QtCore, QtGui, QtWidgets

import pickle
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from pandasgui import show

from src.config import LEGACY_MODEL_DIR, LEGACY_PREDICTIONS_DIR, PROJECT_ROOT
from legacy.src.legacy_pff import (
    default_pff_directory,
    detect_position_from_path,
    preprocess_pff_csv,
)

class Ui_Form(object):
    def setupUi(self, Form):
            
        Form.setObjectName("Form")
        Form.resize(1102, 666)
        Form.setStyleSheet("background-color: qlineargradient(spread:pad, x1:0, y1:0, x2:1, y2:1, stop:0 rgba(0, 170, 255, 255), stop:1 rgba(255, 255, 255, 255));")
        
        self.pushButton1 = QtWidgets.QPushButton(Form)
        self.pushButton1.setGeometry(QtCore.QRect(420, 460, 251, 61))
        self.pushButton1.setStyleSheet("\n"
"background-color: rgb(227, 227, 227);\n"
"color: rgb(62, 62, 62);")
        self.pushButton1.setObjectName("pushButton1")
        
        self.label1 = QtWidgets.QLabel(Form)
        self.label1.setGeometry(QtCore.QRect(240, 170, 591, 201))
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Fixed, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.label1.sizePolicy().hasHeightForWidth())
        self.label1.setSizePolicy(sizePolicy)
        font = QtGui.QFont()
        font.setFamily("Bahnschrift Light")
        font.setPointSize(16)
        self.label1.setFont(font)
        self.label1.setAutoFillBackground(False)
        self.label1.setStyleSheet("background: transparent;\n"
"color: rgb(62, 62, 62);")
        self.label1.setTextFormat(QtCore.Qt.RichText)
        self.label1.setAlignment(QtCore.Qt.AlignCenter)
        self.label1.setWordWrap(True)
        self.label1.setObjectName("label1")
        
        self.widget2 = QtWidgets.QWidget(Form)
        self.widget2.setGeometry(QtCore.QRect(0, 0, 1101, 671))
        self.widget2.setObjectName("widget2")
        
        self.progressBar = QtWidgets.QProgressBar(self.widget2)
        self.progressBar.setGeometry(QtCore.QRect(110, 570, 881, 23))
        self.progressBar.setProperty("value", 0)
        self.progressBar.setProperty("maximum", 10)
        self.progressBar.setObjectName("progressBar")
        
        self.comboBox = QtWidgets.QComboBox(self.widget2)
        self.comboBox.setGeometry(QtCore.QRect(150, 280, 461, 22))
        self.comboBox.setStyleSheet("background: white;")
        self.comboBox.setObjectName("comboBox")
        self.option = ('Select a File')
        self.comboBox.addItem(self.option)

        self.pushButton2 = QtWidgets.QPushButton(self.widget2)
        self.pushButton2.setGeometry(QtCore.QRect(720, 276, 191, 31))
        self.pushButton2.setStyleSheet("background-color: rgb(227, 227, 227)")
        self.pushButton2.setObjectName("pushButton2")
        
        self.pushButton2_1 = QtWidgets.QPushButton(self.widget2)
        self.pushButton2_1.setGeometry(QtCore.QRect(630, 276, 70, 31))
        self.pushButton2_1.setStyleSheet("background-color: rgb(227, 227, 227)")
        self.pushButton2_1.setObjectName("pushButton2_1")
        
        self.label2 = QtWidgets.QLabel(self.widget2)
        self.label2.setGeometry(QtCore.QRect(180, 80, 591, 201))
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Fixed, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.label2.sizePolicy().hasHeightForWidth())
        self.label2.setSizePolicy(sizePolicy)
        font = QtGui.QFont()
        font.setFamily("Bahnschrift Light")
        font.setPointSize(16)
        self.label2.setFont(font)
        self.label2.setAutoFillBackground(False)
        self.label2.setStyleSheet("background: transparent;\n"
"color: rgb(62, 62, 62);")
        self.label2.setTextFormat(QtCore.Qt.RichText)
        self.label2.setAlignment(QtCore.Qt.AlignCenter)
        self.label2.setWordWrap(True)
        self.label2.setObjectName("label2")
        
        self.widget = QtWidgets.QWidget(Form)
        self.widget.setGeometry(QtCore.QRect(-1, -1, 1111, 671))
        self.widget.setObjectName("widget")
        
        self.label3 = QtWidgets.QLabel(self.widget)
        self.label3.setGeometry(QtCore.QRect(240, 150, 591, 201))
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Fixed, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.label3.sizePolicy().hasHeightForWidth())
        self.label3.setSizePolicy(sizePolicy)
        font = QtGui.QFont()
        font.setFamily("Bahnschrift Light")
        font.setPointSize(16)
        self.label3.setFont(font)
        self.label3.setAutoFillBackground(False)
        self.label3.setStyleSheet("background: transparent;\n"
"color: rgb(62, 62, 62);")
        self.label3.setTextFormat(QtCore.Qt.RichText)
        self.label3.setAlignment(QtCore.Qt.AlignCenter)
        self.label3.setWordWrap(True)
        self.label3.setObjectName("label3")
        
        self.pushButton3 = QtWidgets.QPushButton(self.widget)
        self.pushButton3.setGeometry(QtCore.QRect(566, 340, 200, 45))
        self.pushButton3.setStyleSheet("\n"
"background-color: rgb(227, 227, 227);\n"
"color: rgb(62, 62, 62);")
        self.pushButton3.setObjectName("pushButton3")
        
        self.pushButton3_1 = QtWidgets.QPushButton(self.widget)
        self.pushButton3_1.setGeometry(QtCore.QRect(315, 340, 200, 45))
        self.pushButton3_1.setStyleSheet("\n"
"background-color: rgb(227, 227, 227);\n"
"color: rgb(62, 62, 62);")
        self.pushButton3_1.setObjectName("pushButton3_1")
        
        self.labelhidden = QtWidgets.QLabel(self.widget)
        
        self.widget2.hide()
        self.widget.hide()

        self.retranslateUi(Form)
        self.pushButton1.clicked.connect(self.widget2.show)
        self.pushButton1.clicked.connect(self.progressBar.hide)
        # self.progressBar.valueChanged['int'].connect(self.widget2.show)
        # self.pushButton2.clicked.connect(self.progressBar.show)
        self.comboBox.activated['int'].connect(self.launchDialog)
        self.pushButton3.clicked.connect(app.exit)
        self.pushButton3_1.clicked.connect(self.viewData)
        self.pushButton2.clicked.connect(self.startAnalysis)
        self.pushButton2.clicked.connect(self.labelhidden.hide)
        self.pushButton2_1.clicked.connect(self.preview)
        QtCore.QMetaObject.connectSlotsByName(Form)
        
    def viewData(self):
            hidden = self.labelhidden.text()
            date = datetime.now()
            d_string = f"{date.month}{date.day}{date.year}_"
            pred_path = LEGACY_PREDICTIONS_DIR / hidden / f"{d_string}{hidden}DataPreds.csv"
            df = pd.read_csv(pred_path)
            show(df)

    def preview(self):
            response = self.comboBox.currentText()
            df = pd.read_csv(response)
            show(df)
            
            
            
            
    
    def startAnalysis(self):
        
        self.progressBar.show()
        
        response = self.comboBox.currentText()
        
        self.progressBar.setValue(self.progressBar.value() +2)
        
        position = detect_position_from_path(response)
        label = {"qb": "QB", "rb": "RB", "wr": "REC"}[position]
        self.run_legacy_prediction(response, position, label)
        self.labelhidden.setText(label)
        
    def launchDialog(self):
            
        option = self.option.index(self.comboBox.currentText())
        
        if option == 0:
                
                response = self.getFileName()
               
                
        else:
                
                response = self.getFileName()
                
                
        self.comboBox.addItem(response)
        self.comboBox.setCurrentText(response)
        

    def run_legacy_prediction(self, response, position, label):
        model_map = {
            "qb": LEGACY_MODEL_DIR / "qb_prediction.sav",
            "rb": LEGACY_MODEL_DIR / "rb_prediction.sav",
            "wr": LEGACY_MODEL_DIR / "wr_prediction.sav",
        }
        self.progressBar.setValue(self.progressBar.value() + 2)
        df = preprocess_pff_csv(response, position)
        self.progressBar.setValue(self.progressBar.value() + 2)

        with open(model_map[position], "rb") as model_file:
            loaded_model = pickle.load(model_file)

        data = df.drop("pname", axis=1)
        names = df.pop("pname").tolist()
        result = loaded_model.predict(data.values.tolist())
        self.progressBar.setValue(self.progressBar.value() + 2)

        new_df = pd.DataFrame({"Player": names, "Projected Points": result.tolist()})
        date = datetime.now()
        d_string = f"{date.month}{date.day}{date.year}_"
        out_dir = LEGACY_PREDICTIONS_DIR / label
        out_dir.mkdir(parents=True, exist_ok=True)
        new_df.to_csv(out_dir / f"{d_string}{label}DataPreds.csv")
        self.progressBar.setValue(self.progressBar.value() + 2)
        self.widget.show()
        self.widget2.hide()

    def getFileName(self):
        file_filter = "Data File (*.xlsx *.csv *.txt);; Excel File (*.xlsx *.xls)"
        response = QtWidgets.QFileDialog.getOpenFileName(
            parent=Form,
            caption="Select a stat file",
            directory=default_pff_directory(),
            filter=file_filter,
            initialFilter="Data File (*.xlsx *.csv *.txt)",
        )
        print(response[0])
        return response[0]
        
        

    def retranslateUi(self, Form):
        _translate = QtCore.QCoreApplication.translate
        Form.setWindowTitle(_translate("Form", "ScoreSense"))
        self.pushButton1.setText(_translate("Form", "Begin"))
        self.label1.setText(_translate("Form", "Welcome to ScoreSense. An application built for predicting NFL fantasy performance by leveraging sophisticated machine learning techniques and real world data. "))
        self.pushButton2.setText(_translate("Form", "Submit"))
        self.pushButton2_1.setText(_translate("Form", "Preview"))
        self.label2.setText(_translate("Form", "Please select the file containing players and their stats you would like to run analysis on. Upload them below:"))
        self.label3.setText(_translate("Form", "Thank you for submitting! Your predictions file has been generated!"))
        self.pushButton3.setText(_translate("Form", "Exit"))
        self.pushButton3_1.setText(_translate("Form", "View Results"))
        self.labelhidden.setText(_translate("Form", "Hidden"))


if __name__ == "__main__":
    import sys
    app = QtWidgets.QApplication(sys.argv)
    Form = QtWidgets.QWidget()
    ui = Ui_Form()
    ui.setupUi(Form)
    Form.show()
    sys.exit(app.exec_())

